import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Download, Copy, Check, Trash2, ExternalLink } from 'lucide-react';
import { RubricData, CanvasConfig } from '../types';
import {
  generateCsvFromRubricObject,
  generateAllCsvsFromDoc,
  BATCH_RUBRIC_LIMIT,
  generateCsvForRubric,
  discoverRubricTitles,
} from '../services/geminiService';
import JSZip from 'jszip';
import { diagnoseCanvasError, CanvasDiagnosis } from '../utils/diagnoseCanvasError';
import { CsvRepairPanel } from './CsvRepairPanel';
import { useCopyAction } from '../hooks/useCopyAction';

/**
 * How long to wait before the single retry.
 *
 * Long enough for a rate limit to clear or a blip to pass, short enough that a user watching the
 * timeline does not think it has hung.
 */
const RETRY_DELAY_MS = 2000;

/**
 * How many rubrics a document may hold before each one is converted on its own.
 *
 * The one-request route asks the model for every rubric in the document and needs all of them
 * back in a single response, which is capped at 64k output tokens. A 26-rubric document reached
 * that cap four minutes in, the JSON was cut off mid-string, and every rubric converted up to
 * that point was discarded — one red line, nothing deployed. The cap is on total size, not on the
 * count, so this threshold is a proxy: eight rubrics of any plausible length fit comfortably.
 *
 * Above it, each rubric becomes its own request. There is no shared ceiling then, and a rubric
 * that fails costs only itself. Below it the single request is kept because it is one call rather
 * than N+1 and noticeably faster on the small documents that are the common case.
 */

/**
 * Gap between per-rubric calls, matching Part 2, which has always converted this way.
 * Adaptive: only the remainder of the gap is waited out after a call returns.
 */
const RUBRIC_CALL_GAP_MS = 6000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UploadedDocFile {
  name: string;
  data: string; // base64
  mimeType: string;
}

interface RubricResult {
  name: string;
  status: 'success' | 'failed';
  error?: string;
  csvContent?: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

type RunStatus = 'running' | 'complete' | 'cancelled';

interface Props {
  /** Phase 1 "No" path — rubric already generated */
  phase1Rubric?: RubricData | null;
  scoringMethod?: 'ranges' | 'fixed';
  /** "Yes" path — user-uploaded document files */
  uploadedFiles?: UploadedDocFile[];
  courseUrl: string;
  onStartOver?: () => void;
  /** Open Initial Setup, for the failures a credential or the course URL would fix. */
  onOpenSetup?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });

const formatMs = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

// ─── Component ───────────────────────────────────────────────────────────────

export const AnalyzeDeploySection: React.FC<Props> = ({
  onOpenSetup,
  phase1Rubric,
  scoringMethod = 'ranges',
  uploadedFiles = [],
  courseUrl,
  onStartOver,
}) => {
  const [runStatus, setRunStatus] = useState<RunStatus>('running');
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [estimatedMs, setEstimatedMs] = useState(0);
  const { state: copyState, copy } = useCopyAction();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<RubricResult[]>([]);

  /**
   * Every CSV the run has produced, published as each one arrives.
   *
   * `results` only ever held finished deploy outcomes, and it was assigned once, after the deploy
   * loop finished. Cancelling threw past that line, so a run stopped at rubric 18 of 20 discarded
   * all twenty CSVs — including the ones that had already deployed — and the download offer, being
   * gated on the run reaching 'complete', had nothing to show either. The expensive half of the
   * work is the conversion; losing it because the cheap half was interrupted is the wrong way
   * round.
   */
  const [convertedCsvs, setConvertedCsvs] = useState<{ name: string; csvContent: string }[]>([]);
  const [csvPromptAnswer, setCsvPromptAnswer] = useState<'yes' | 'no' | null>(null);
  /**
   * Rubrics that failed and then deployed from an AI repair.
   *
   * Held separately because a repaired rubric's result flips to 'success', which removes it from
   * the failure panel along with the confirmation that it was repaired. Without this the only
   * trace would be a line in a scrolling console.
   */
  const [repairedNames, setRepairedNames] = useState<string[]>([]);

  const abortRef = useRef<AbortController>(new AbortController());
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const hasStarted = useRef(false);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs((prev) => [...prev, { timestamp: now(), message, type }]);
  };

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Start timer
  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedMs(elapsed);
    }, 250);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMs(Date.now() - startTimeRef.current);
  };

  // Main orchestration
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const run = async () => {
      const signal = abortRef.current.signal;
      startTimer();

      try {
        // ── Step 1: Convert to CSV ───────────────────────────────────────────
        const pending: { name: string; csvContent: string }[] = [];

        if (phase1Rubric) {
          addLog(`Converting "${phase1Rubric.title}" to CSV…`, 'info');
          const csv = generateCsvFromRubricObject(phase1Rubric, scoringMethod);
          pending.push({ name: phase1Rubric.title, csvContent: csv });
          setConvertedCsvs((prev) => [...prev, { name: phase1Rubric.title, csvContent: csv }]);
          setProgress(30);
          addLog(`CSV generated: "${phase1Rubric.title}"`, 'success');
        } else if (uploadedFiles.length > 0) {
          const totalFiles = uploadedFiles.length;
          for (let i = 0; i < totalFiles; i++) {
            if (signal.aborted) throw new Error('Cancelled');
            const file = uploadedFiles[i];
            addLog(`Analyzing "${file.name}"…`, 'info');
            const attachment = { name: file.name, mimeType: file.mimeType, data: file.data };
            try {
              // Count first. This is a cheap call — titles only, no CSV — and it decides which
              // route the document takes as well as giving the user the list up front.
              const discovered = await discoverRubricTitles(attachment, signal);
              addLog(`Found ${discovered.length} rubric(s) in "${file.name}"`, 'success');

              if (discovered.length <= BATCH_RUBRIC_LIMIT) {
                const extracted = await generateAllCsvsFromDoc(attachment, signal);
                extracted.forEach((r) => {
                  pending.push({ name: r.title, csvContent: r.csv });
                  addLog(`CSV generated: "${r.title}"`, 'success');
                });
                setConvertedCsvs((prev) => [
                  ...prev,
                  ...extracted.map((r) => ({ name: r.title, csvContent: r.csv })),
                ]);
              } else {
                addLog(
                  `Converting them one at a time — more than ${BATCH_RUBRIC_LIMIT} rubrics is too ` +
                    'much for a single request. This takes longer but nothing is lost if one fails.',
                  'info',
                );
                for (let r = 0; r < discovered.length; r++) {
                  if (signal.aborted) throw new Error('Cancelled');
                  const rubric = discovered[r];
                  const callStart = Date.now();
                  try {
                    const csv = await generateCsvForRubric(
                      rubric.name,
                      '',
                      rubric.scoringMethod,
                      attachment,
                      signal,
                    );
                    // Pushed as it arrives, so a later failure cannot discard the earlier work.
                    pending.push({ name: rubric.name, csvContent: csv });
                    setConvertedCsvs((prev) => [...prev, { name: rubric.name, csvContent: csv }]);
                    addLog(`CSV generated: "${rubric.name}" (${r + 1} of ${discovered.length})`, 'success');
                  } catch (err: any) {
                    if (signal.aborted) throw err;
                    // One rubric, one failure. The rest of the document still deploys.
                    addLog(`Could not convert "${rubric.name}": ${err.message}`, 'error');
                  }
                  // Stay inside the per-minute request limit without adding needless delay.
                  const waited = Date.now() - callStart;
                  if (waited < RUBRIC_CALL_GAP_MS && r < discovered.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, RUBRIC_CALL_GAP_MS - waited));
                  }
                }
              }
            } catch (err: any) {
              if (signal.aborted) throw err;
              addLog(`Failed to analyze "${file.name}": ${err.message}`, 'error');
            }
            setProgress(Math.round(((i + 1) / totalFiles) * 40));
            // Update ETA
            const elapsed = Date.now() - startTimeRef.current;
            const pct = (i + 1) / totalFiles;
            setEstimatedMs(pct > 0 ? elapsed / pct : 0);
          }
        }

        if (pending.length === 0) {
          addLog('No rubrics found to deploy.', 'warning');
          stopTimer();
          setRunStatus('complete');
          setProgress(100);
          return;
        }

        addLog(`Ready to deploy ${pending.length} rubric(s) to Canvas…`, 'info');

        // ── Step 2: Deploy to Canvas ─────────────────────────────────────────
        const finalResults: RubricResult[] = [];

        for (let i = 0; i < pending.length; i++) {
          if (signal.aborted) throw new Error('Cancelled');
          const item = pending[i];
          addLog(`Deploying "${item.name}" to Canvas…`, 'info');

          /**
           * One automatic retry, and only for failures that could plausibly go away.
           *
           * A rate limit, a dropped connection or a Canvas 500 is frequently over within
           * seconds, and asking someone to re-run a ten-rubric batch because of one is a poor
           * trade against a single extra request. A rejected token or a course ID that does not
           * exist is never transient: retrying those just makes the same failure arrive later,
           * so diagnoseCanvasError decides which is which rather than a blanket retry.
           */
          let attempt = 0;
          for (;;) {
            if (signal.aborted) throw new Error('Cancelled');
            let message: string | undefined;
            try {
              const res = await window.api.canvas.pushRubric({
                csvContent: item.csvContent,
                courseUrl,
              });
              if (res.success) {
                addLog(`✓ "${item.name}" deployed successfully`, 'success');
                finalResults.push({ name: item.name, status: 'success', csvContent: item.csvContent });
                break;
              }
              message = res.message;
            } catch (err: any) {
              if (signal.aborted) throw err;
              message = err?.message;
            }

            const diagnosis = diagnoseCanvasError(message);
            if (diagnosis.transient && attempt === 0) {
              attempt += 1;
              addLog(`"${item.name}" — ${diagnosis.cause} Retrying once…`, 'warning');
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
              continue;
            }

            addLog(`✗ "${item.name}" failed: ${message}`, 'error');
            // The cause is logged separately from Canvas's own words so the timeline says what
            // to do, while still showing exactly what Canvas reported.
            addLog(`   ${diagnosis.cause} ${diagnosis.fix}`, 'warning');
            finalResults.push({
              name: item.name,
              status: 'failed',
              error: message,
              csvContent: item.csvContent,
            });
            break;
          }

          // Published each time round, so a cancelled deploy still shows what did reach Canvas.
          setResults([...finalResults]);

          const deployPct = 40 + Math.round(((i + 1) / pending.length) * 60);
          setProgress(deployPct);
          const elapsed = Date.now() - startTimeRef.current;
          const pct = deployPct / 100;
          setEstimatedMs(pct > 0 ? elapsed / pct : 0);
        }

        setResults([...finalResults]);
        const successCount = finalResults.filter((r) => r.status === 'success').length;
        const failCount = finalResults.filter((r) => r.status === 'failed').length;
        addLog(
          `Done — ${successCount} deployed successfully${failCount > 0 ? `, ${failCount} failed` : ''}.`,
          failCount === 0 ? 'success' : 'warning',
        );

      } catch (err: any) {
        if (err.message === 'Cancelled') {
          addLog('Operation cancelled by user.', 'warning');
          setRunStatus('cancelled');
        } else {
          addLog(`Unexpected error: ${err.message}`, 'error');
          setRunStatus('complete');
        }
      } finally {
        stopTimer();
        if (!abortRef.current.signal.aborted) {
          setRunStatus('complete');
          setProgress(100);
        }
      }
    };

    run();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      // Abort too, not just the timer. Without this, navigating away mid-run left the loop
      // POSTing rubrics to Canvas and calling setState on an unmounted component.
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    abortRef.current.abort();
  };

  const handleDownloadCsvs = async () => {
    // From the converted list rather than from deploy results: a rubric that never reached Canvas
    // still has a CSV worth keeping, and after a cancel it is the only record of the work.
    const withCsv = convertedCsvs;
    if (withCsv.length === 0) return;
    // Saved through the native dialog: an anchor-click download does not work from a file://
    // page, and used to fail silently.
    if (withCsv.length === 1) {
      await window.api.file.saveText({
        defaultName: `${withCsv[0].name.replace(/[^a-z0-9]/gi, '_')}.csv`,
        ext: 'csv',
        label: 'CSV file',
        content: withCsv[0].csvContent,
      });
    } else {
      const zip = new JSZip();
      withCsv.forEach((r) => {
        zip.file(`${r.name.replace(/[^a-z0-9]/gi, '_')}.csv`, r.csvContent);
      });
      // uint8array rather than blob: the bytes have to cross IPC, and a Blob does not.
      const bytes = (await zip.generateAsync({ type: 'uint8array' })) as Uint8Array;
      await window.api.file.saveText({
        defaultName: 'rubric_csvs.zip',
        ext: 'zip',
        label: 'Zip archive',
        content: bytes,
      });
    }
  };

  const handleCsvYes = async () => {
    setCsvPromptAnswer('yes');
    await handleDownloadCsvs();
  };

  const handleCsvNo = () => {
    // Only dismisses the prompt. The CSVs stay in state on purpose: a failed rubric's CSV is what
    // an AI repair works from, and declining a download should not take the repair offer away.
    setCsvPromptAnswer('no');
  };

  /**
   * A rubric that failed, was repaired, and went to Canvas on the second attempt.
   *
   * Matched on the result object itself, not on its name. A document can hold two rubrics with
   * the same title — the eCampus demo set has several near-duplicates — and matching by name
   * marked both of them succeeded when only one had been repaired, which is a false report about
   * what is in someone's Canvas course.
   *
   * The repaired CSV replaces the rejected one, so the download offered afterwards is the file
   * that actually deployed.
   */
  const handleRepairDeployed = (target: RubricResult, repairedCsv: string) => {
    setRepairedNames((prev) => (prev.includes(target.name) ? prev : [...prev, target.name]));
    setResults((prev) =>
      prev.map((r) =>
        r === target
          ? { ...r, status: 'success', error: undefined, csvContent: repairedCsv }
          : r,
      ),
    );
  };

  /**
   * The log, with enough at the top to identify it once it has been pasted somewhere else.
   *
   * This gets sent to whoever can help — in a message, a ticket, an email — and arrives stripped
   * of everything the screen was showing around it. A bare list of timestamps with no date, no
   * version and no course leaves the reader asking three questions before they can start.
   *
   * The Canvas token cannot appear here. The renderer is never given it, so it has nothing to
   * leak; the course URL is not a secret and is the single most useful line for diagnosis.
   */
  const handleCopyLogs = async () => {
    const header = [
      `Canvas Rubric Creator v${await window.api.app.version()} — deployment log`,
      `Copied ${new Date().toLocaleString()}`,
      courseUrl ? `Course: ${courseUrl}` : 'Course: (none set)',
      `${results.length} rubric(s): ${successCount} deployed, ${failCount} failed`,
      '',
    ].join('\n');
    await copy(header + logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n'));
  };

  const handleClearLogs = () => setLogs([]);

  const successCount = results.filter((r) => r.status === 'success').length;
  const failCount = results.filter((r) => r.status === 'failed').length;
  const isRunning = runStatus === 'running';

  /**
   * What a screen reader is told when the run ends.
   *
   * Empty while the run is in flight, for two reasons. The live region is mounted for the whole
   * run rather than appearing at the end — a region that arrives with text already inside it is
   * not reliably announced — and an empty value means mounting it says nothing. And a rubric-by
   * -rubric announcement would interrupt the user twenty-six times on a long document; the
   * progress bar below carries `aria-valuenow`, so progress can be checked on demand instead of
   * being pushed. This fires once, when there is something worth saying.
   */
  const runAnnouncement =
    runStatus === 'running'
      ? ''
      : runStatus === 'cancelled'
      ? `Stopped. ${successCount} of ${results.length} rubrics deployed, ${failCount} failed.`
      : `Finished. ${successCount} of ${results.length} rubrics deployed` +
        (failCount > 0 ? `, ${failCount} failed.` : '.');

  /** Distinct failure causes, each with the rubrics it accounts for, in the order they failed. */
  const failureGroups = React.useMemo(() => {
    const groups = new Map<string, { diagnosis: CanvasDiagnosis; items: RubricResult[] }>();
    for (const r of results) {
      if (r.status !== 'failed') continue;
      const diagnosis = diagnoseCanvasError(r.error);
      const existing = groups.get(diagnosis.cause);
      if (existing) existing.items.push(r);
      else groups.set(diagnosis.cause, { diagnosis, items: [r] });
    }
    return [...groups.values()];
  }, [results]);
  const rubricPageUrl = courseUrl.trim().replace(/\/?$/, '') + '/rubrics';

  // ─── Summary header (replaces spinner when done) ──────────────────────────
  const renderSummaryHeader = () => {
    if (isRunning) {
      return (
        <div className="flex items-center gap-3">
          <Loader2 className="w-6 h-6 text-blue-700 animate-spin flex-shrink-0" />
          <div>
            <p className="font-black text-gray-900">Analyzing & Deploying…</p>
            <p className="text-sm text-gray-600">Please wait while we process your rubric(s)</p>
          </div>
        </div>
      );
    }
    if (runStatus === 'cancelled') {
      return (
        <div className="flex items-center gap-3">
          <XCircle className="w-6 h-6 text-amber-500 flex-shrink-0" />
          <p className="font-black text-gray-900">Cancelled</p>
        </div>
      );
    }
    // Complete
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
            <span className="font-black text-gray-900">
              {successCount > 0
                ? `${successCount} rubric${successCount !== 1 ? 's' : ''} deployed successfully`
                : 'Deployment complete'}
            </span>
          </div>
          {failCount > 0 && (
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <span className="font-bold text-red-700">{failCount} failed</span>
            </div>
          )}
        </div>
        {repairedNames.length > 0 && (
          <p
            className="text-sm font-bold text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2"
            role="status"
          >
            Deployed from an AI repair: {repairedNames.join(', ')}. Check the point values in Canvas.
          </p>
        )}
        {successCount > 0 && (
          <a
            href={rubricPageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-bold hover:underline"
          >
            Verify at Canvas Rubrics page <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {/*
          What went wrong, and what to do about it.
          Grouped by cause: ten rubrics failing for one reason is one problem to explain, not ten.
        */}
        {failureGroups.length > 0 && (
          <div
            className="mt-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 space-y-3"
            role="region"
            aria-label="What went wrong"
          >
            <p className="font-black text-sm text-amber-900 uppercase tracking-wide">
              What went wrong
            </p>
            {failureGroups.map((group) => (
              <div key={group.diagnosis.cause} className="space-y-1">
                <p className="text-sm font-bold text-gray-900">{group.diagnosis.cause}</p>
                {group.diagnosis.fix && (
                  <p className="text-sm text-gray-700">{group.diagnosis.fix}</p>
                )}
                <p className="text-xs text-gray-600">
                  {group.items.length === 1
                    ? group.items[0].name
                    : `${group.items.length} rubrics: ${group.items.map((r) => r.name).join(', ')}`}
                </p>
                {group.diagnosis.action.kind === 'open-setup' && onOpenSetup && (
                  <button
                    onClick={onOpenSetup}
                    className="mt-1 px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand-dark transition-all"
                  >
                    {group.diagnosis.action.label}
                  </button>
                )}
                {/*
                  Only offered where Canvas objected to the rubric's own contents. On a dead token
                  or a wrong course ID there is nothing in the file to fix, and offering anyway
                  would send someone to study a CSV that was never the problem.

                  Per rubric rather than per group: each one failed with its own file and its own
                  message, and both are what the repair works from.
                */}
                {group.diagnosis.repairable &&
                  group.items.map(
                    (item, idx) =>
                      item.csvContent && (
                        <CsvRepairPanel
                          // Index too: two rubrics in one document can share a title, and a key
                          // that collides makes React reuse one panel's state for the other.
                          key={`${item.name}-${idx}`}
                          rubricName={item.name}
                          csvContent={item.csvContent}
                          canvasMessage={item.error ?? ''}
                          courseUrl={courseUrl}
                          onDeployed={(_name, repairedCsv) =>
                            handleRepairDeployed(item, repairedCsv)
                          }
                          onLog={addLog}
                        />
                      ),
                  )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-8 border-t border-gray-200 pt-8 space-y-4">
      {/* Summary header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        {renderSummaryHeader()}

        <span role="status" aria-live="polite" className="sr-only">
          {runAnnouncement}
        </span>

        {/* Progress bar */}
        <div className="mt-4">
          <div
            className="h-2 bg-gray-100 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Conversion and deployment progress"
          >
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                runStatus === 'complete' && failCount === 0
                  ? 'bg-green-500'
                  : runStatus === 'complete' && failCount > 0
                  ? 'bg-amber-500'
                  : runStatus === 'cancelled'
                  ? 'bg-gray-400'
                  : 'bg-blue-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Timing row */}
        <div className="flex items-center justify-between mt-2 text-xs text-gray-600">
          <span>Elapsed: {formatMs(elapsedMs)}</span>
          {isRunning && (
            estimatedMs > 0
              ? <span>Est. remaining: {formatMs(Math.max(0, estimatedMs - elapsedMs))}</span>
              : <span className="italic">Time estimate will appear shortly.</span>
          )}
          {isRunning && (
            <button
              onClick={handleCancel}
              className="text-red-600 font-bold hover:underline"
            >
              Cancel
            </button>
          )}
        </div>

        {/* CSV download prompt — shown after completion if CSVs are available */}
        {runStatus !== 'running' && convertedCsvs.length > 0 && csvPromptAnswer === null && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
            <span className="text-sm font-bold text-gray-700">
              Would you like CSV versions of each rubric?
            </span>
            <button
              onClick={handleCsvYes}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all active:scale-95"
            >
              <Download className="w-4 h-4" /> Yes, download
            </button>
            <button
              onClick={handleCsvNo}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 transition-all"
            >
              No thanks
            </button>
          </div>
        )}
        {runStatus === 'complete' && csvPromptAnswer === 'yes' && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-green-700 font-bold flex items-center gap-2">
              <Download className="w-4 h-4" />
              CSV{results.filter((r) => r.csvContent).length !== 1 ? 's' : ''} downloaded.
            </p>
          </div>
        )}
      </div>

      {/* Deployment Timeline */}
      <div className="rounded-2xl overflow-hidden border border-gray-700 shadow-lg">
        {/* Header bar */}
        <div className="bg-[#1a1a2e] px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-black text-gray-300 uppercase tracking-widest">
            Deployment Timeline
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleCopyLogs()}
              disabled={logs.length === 0}
              className={`text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-40 ${
                copyState === 'failed'
                  ? 'text-amber-300'
                  : copyState === 'copied'
                    ? 'text-green-300'
                    : 'text-gray-300 hover:text-white'
              }`}
            >
              {copyState === 'copied' ? (
                <Check className="w-3 h-3" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copyState === 'copied'
                ? 'Copied'
                : copyState === 'failed'
                  ? 'Could not copy'
                  : 'Copy Logs'}
            </button>
            <button
              onClick={handleClearLogs}
              className="text-xs text-gray-300 hover:text-white font-bold flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>

        {/* Log body.
            text-gray-400 rather than -600 for the secondary text. #4b5563 on this near-black
            panel is 2.6:1 — the design system's warning that the light-background greys "do not
            carry over" to dark ones, landing exactly as described. #9ca3af is 7.6:1, which keeps
            timestamps visibly quieter than the messages beside them while still being readable. */}
        <div className="bg-[#0d0d1a] p-4 h-56 overflow-y-auto font-mono text-xs space-y-1">
          {logs.length === 0 ? (
            <p className="text-gray-400 italic">No activity yet.</p>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-gray-400 flex-shrink-0">[{entry.timestamp}]</span>
                <span
                  className={
                    entry.type === 'success'
                      ? 'text-green-400'
                      : entry.type === 'error'
                      ? 'text-red-400'
                      : entry.type === 'warning'
                      ? 'text-amber-400'
                      : 'text-gray-300'
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Start Over card — shown when deployment is complete */}
      {runStatus === 'complete' && onStartOver && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm font-bold text-gray-800">
            Deployment attempt complete. Would you like to start over from the beginning?
          </p>
          <button
            onClick={onStartOver}
            className="flex-shrink-0 px-6 py-2.5 bg-brand text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-brand-dark transition-all active:scale-95 shadow"
          >
            Yes, please
          </button>
        </div>
      )}
    </div>
  );
};
