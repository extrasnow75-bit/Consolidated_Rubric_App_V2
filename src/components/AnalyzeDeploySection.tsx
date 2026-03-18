import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Download, Copy, Trash2, ExternalLink } from 'lucide-react';
import { RubricData, CanvasConfig } from '../types';
import { generateCsvFromRubricObject, generateAllCsvsFromDoc } from '../services/geminiService';
import { pushRubricToCanvas } from '../services/canvasService';
import JSZip from 'jszip';

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
  canvasToken: string;
  onStartOver?: () => void;
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
  phase1Rubric,
  scoringMethod = 'ranges',
  uploadedFiles = [],
  courseUrl,
  canvasToken,
  onStartOver,
}) => {
  const [runStatus, setRunStatus] = useState<RunStatus>('running');
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [estimatedMs, setEstimatedMs] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<RubricResult[]>([]);
  const [csvPromptAnswer, setCsvPromptAnswer] = useState<'yes' | 'no' | null>(null);

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
          setProgress(30);
          addLog(`CSV generated: "${phase1Rubric.title}"`, 'success');
        } else if (uploadedFiles.length > 0) {
          const totalFiles = uploadedFiles.length;
          for (let i = 0; i < totalFiles; i++) {
            if (signal.aborted) throw new Error('Cancelled');
            const file = uploadedFiles[i];
            addLog(`Analyzing "${file.name}"…`, 'info');
            try {
              const extracted = await generateAllCsvsFromDoc(
                { name: file.name, mimeType: file.mimeType, data: file.data },
                signal,
              );
              addLog(`Found ${extracted.length} rubric(s) in "${file.name}"`, 'success');
              extracted.forEach((r) => {
                pending.push({ name: r.title, csvContent: r.csv });
                addLog(`CSV generated: "${r.title}"`, 'success');
              });
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
        const config: CanvasConfig = { courseHomeUrl: courseUrl, accessToken: canvasToken };
        const finalResults: RubricResult[] = [];

        for (let i = 0; i < pending.length; i++) {
          if (signal.aborted) throw new Error('Cancelled');
          const item = pending[i];
          addLog(`Deploying "${item.name}" to Canvas…`, 'info');

          try {
            const res = await pushRubricToCanvas(config, item.csvContent);
            if (res.success) {
              addLog(`✓ "${item.name}" deployed successfully`, 'success');
              finalResults.push({ name: item.name, status: 'success', csvContent: item.csvContent });
            } else {
              addLog(`✗ "${item.name}" failed: ${res.message}`, 'error');
              finalResults.push({ name: item.name, status: 'failed', error: res.message, csvContent: item.csvContent });
            }
          } catch (err: any) {
            if (signal.aborted) throw err;
            addLog(`✗ "${item.name}" error: ${err.message}`, 'error');
            finalResults.push({ name: item.name, status: 'failed', error: err.message, csvContent: item.csvContent });
          }

          const deployPct = 40 + Math.round(((i + 1) / pending.length) * 60);
          setProgress(deployPct);
          const elapsed = Date.now() - startTimeRef.current;
          const pct = deployPct / 100;
          setEstimatedMs(pct > 0 ? elapsed / pct : 0);
        }

        setResults(finalResults);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    abortRef.current.abort();
  };

  const handleDownloadCsvs = async () => {
    const withCsv = results.filter((r) => r.csvContent);
    if (withCsv.length === 0) return;
    if (withCsv.length === 1) {
      const blob = new Blob([withCsv[0].csvContent!], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${withCsv[0].name.replace(/[^a-z0-9]/gi, '_')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const zip = new JSZip();
      withCsv.forEach((r) => {
        zip.file(`${r.name.replace(/[^a-z0-9]/gi, '_')}.csv`, r.csvContent!);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rubric_csvs.zip';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleCsvYes = async () => {
    setCsvPromptAnswer('yes');
    await handleDownloadCsvs();
  };

  const handleCsvNo = () => {
    setCsvPromptAnswer('no');
    setResults((prev) => prev.map((r) => ({ ...r, csvContent: undefined })));
  };

  const handleCopyLogs = () => {
    const text = logs.map((l) => `[${l.timestamp}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handleClearLogs = () => setLogs([]);

  const successCount = results.filter((r) => r.status === 'success').length;
  const failCount = results.filter((r) => r.status === 'failed').length;
  const isRunning = runStatus === 'running';
  const rubricPageUrl = courseUrl.trim().replace(/\/?$/, '') + '/rubrics';

  // ─── Summary header (replaces spinner when done) ──────────────────────────
  const renderSummaryHeader = () => {
    if (isRunning) {
      return (
        <div className="flex items-center gap-3">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin flex-shrink-0" />
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
      </div>
    );
  };

  return (
    <div className="mt-8 border-t border-gray-200 pt-8 space-y-4">
      {/* Summary header */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        {renderSummaryHeader()}

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
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
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
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
        {runStatus === 'complete' && results.some((r) => r.csvContent) && csvPromptAnswer === null && (
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
              onClick={handleCopyLogs}
              className="text-xs text-gray-400 hover:text-gray-200 font-bold flex items-center gap-1 transition-colors"
            >
              <Copy className="w-3 h-3" />
              Copy Logs
            </button>
            <button
              onClick={handleClearLogs}
              className="text-xs text-gray-400 hover:text-gray-200 font-bold flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>

        {/* Log body */}
        <div className="bg-[#0d0d1a] p-4 h-56 overflow-y-auto font-mono text-xs space-y-1">
          {logs.length === 0 ? (
            <p className="text-gray-500 italic">No activity yet.</p>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-gray-500 flex-shrink-0">[{entry.timestamp}]</span>
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
            className="flex-shrink-0 px-6 py-2.5 bg-green-600 text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95 shadow"
          >
            Yes, please
          </button>
        </div>
      )}
    </div>
  );
};
