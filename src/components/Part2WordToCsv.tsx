import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, Attachment, RubricMeta, ProcessingType } from '../types';
import {
  generateCsvForRubric,
  generateAllCsvsFromDoc,
  generateCsvFromRubricObject,
} from '../services/geminiService';
import { friendlyError } from './ErrorDisplay';
import {
  Upload,
  Download,
  Loader2,
  Copy,
  Check,
  Link as LinkIcon,
  StopCircle,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  PackageOpen,
  Zap,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  FolderOpen,
} from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import { googleDriveService } from '../services/googleDriveService';


// ─── Types ────────────────────────────────────────────────────────────

interface RubricResult {
  rubric: RubricMeta;
  status: 'pending' | 'generating' | 'done' | 'error';
  csvContent?: string;
  error?: string;
}

/**
 * Compact inline error for rubric result cards.
 * Shows a short plain-English message with a toggleable full-error section.
 */
const RubricErrorLine: React.FC<{ error: string }> = ({ error }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <p className="text-xs text-red-600 mt-0.5 leading-tight">
        {friendlyError(error, true)}
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
        className="text-[10px] text-red-400 hover:text-red-600 mt-0.5 underline underline-offset-2"
      >
        {expanded ? 'hide details' : 'view full error'}
      </button>
      {expanded && (
        <pre className="mt-1.5 text-[10px] text-red-500 bg-red-50 border border-red-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {error}
        </pre>
      )}
    </>
  );
};

// ─── Component ────────────────────────────────────────────────────────

export const Part2WordToCsv: React.FC = () => {
  const {
    state,
    setCurrentStep,
    setCsvOutput,
    setIsLoading,
    setError,
    setTaskCompletionOpen,
    startProgress,
    stopProgress,
    setProgress,
    extractGoogleSheetCsv,
    startGoogleAuth,
  } = useSession();

  // ── File / attachment state ──────────────────────────────────────────
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [rubricOptions, setRubricOptions] = useState<RubricMeta[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Input mode (file upload vs Google Sheets) ────────────────────────
  const [inputMode, setInputMode] = useState<'from-phase1' | 'file' | 'google-sheet'>(state.rubric ? 'from-phase1' : 'file');
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [fetchingGoogleSheet, setFetchingGoogleSheet] = useState(false);
  const [pickingFromDrive, setPickingFromDrive] = useState(false);

  // ── Single-rubric editable fields ────────────────────────────────────
  const [processingType, setProcessingType] = useState<ProcessingType>(
    ProcessingType.SINGLE,
  );
  const [editableRubricName, setEditableRubricName] = useState('');
  const [editableTotalPoints, setEditableTotalPoints] = useState('');
  const [editableScoringMethod, setEditableScoringMethod] = useState<
    'ranges' | 'fixed'
  >('ranges');
  const [singleCsvContent, setSingleCsvContent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Multi-rubric parallel generation ────────────────────────────────
  const [rubricResults, setRubricResults] = useState<RubricResult[]>([]);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Live timer for estimated time to completion ──────────────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const generationStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/stop the elapsed-time ticker whenever batch generation starts/stops
  useEffect(() => {
    if (isGeneratingAll) {
      generationStartRef.current = Date.now();
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(
          Math.floor((Date.now() - (generationStartRef.current ?? Date.now())) / 1000),
        );
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isGeneratingAll]);

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Core download utility — appends anchor to DOM, clicks, then revokes after delay. */
  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  /** Download a CSV string as a .csv file. */
  const downloadCsv = useCallback(
    (content: string, filename: string) => {
      const safeFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
      downloadBlob(new Blob([content], { type: 'text/csv;charset=utf-8;' }), safeFilename);
    },
    [downloadBlob],
  );

  const resetForNewFile = () => {
    setAttachments([]);
    setRubricOptions([]);
    setRubricResults([]);
    setSingleCsvContent(null);
    setEditableRubricName('');
    setEditableTotalPoints('');
    setEditableScoringMethod('ranges');
    setProcessingType(ProcessingType.SINGLE);
    setError(null);
    // Cancel any in-flight generation
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGeneratingAll(false);
    setIsLoading(false);
    stopProgress();
  };

  // ── Phase 1 → Phase 2 carry-forward ──────────────────────────────────

  /** True when the user arrived here via "Continue to Part 2" from Phase 1. */
  const fromPhase1 = Boolean(state.rubric);

  /** Infer scoring method from Phase 1 point strings (e.g. "40-50" = ranges). */
  const inferScoringMethod = (): 'ranges' | 'fixed' => {
    const points = state.rubric?.criteria?.[0]?.exemplary?.points ?? '';
    return points.includes('-') ? 'ranges' : 'fixed';
  };

  // Pre-fill editable fields from Phase 1 rubric on first mount.
  useEffect(() => {
    if (state.rubric && !editableRubricName) {
      setEditableRubricName(state.rubric.title);
      setEditableTotalPoints(String(state.rubric.totalPoints));
      setEditableScoringMethod(inferScoringMethod());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rubric]);

  /** Generate Canvas CSV directly from Phase 1 rubric — no file or API call needed. */
  const handleGenerateFromPhase1 = () => {
    if (!state.rubric) return;
    const csv = generateCsvFromRubricObject(state.rubric, editableScoringMethod);
    const name = editableRubricName || state.rubric.title;
    const fileName = `${name}.csv`;
    setSingleCsvContent(csv);
    setCsvOutput(csv, fileName);
    setProcessingType(ProcessingType.SINGLE); // ensure result view always shows
    if (!editableRubricName) setEditableRubricName(name);
  };

  // ── File handling ─────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
  };

  const handleFileSelect = async (file: File) => {
    resetForNewFile();

    const isDocxFile = file.name.endsWith('.docx') || file.name.endsWith('.doc');
    const isPdf = file.name.endsWith('.pdf');

    if (!isDocxFile && !isPdf) {
      setError('Please upload a Word (.docx) or PDF file');
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer)),
      );
      const mimeType = isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      const attachment: Attachment = { name: file.name, mimeType, data: base64Data };
      setAttachments([attachment]);

      // Pre-fill rubric name from filename (strip extension + clean up separators)
      const nameFromFile = file.name
        .replace(/\.(docx?|pdf)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      setEditableRubricName(nameFromFile);

      // No Gemini call on upload — batch generation happens when the user
      // clicks "Generate All CSVs" (MULTIPLE mode) or "Generate Canvas CSV" (SINGLE mode).
    } catch (err: any) {
      setError(`Error reading file: ${err.message}`);
    }
  };

  // ── Single-rubric generation ──────────────────────────────────────────

  const handleGenerateSingle = async () => {
    if (attachments.length === 0) return;
    if (!editableRubricName.trim()) {
      setError('Please enter a rubric name');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    startProgress(1, true);
    setProgress({ currentStep: 'Generating Canvas CSV…' });

    try {
      const csv = await generateCsvForRubric(
        editableRubricName,
        editableTotalPoints,
        editableScoringMethod,
        attachments[0],
        controller.signal,
      );

      if (controller.signal.aborted) return;

      setSingleCsvContent(csv);
      setCsvOutput(csv, `${editableRubricName}.csv`);
      setProcessingType(ProcessingType.SINGLE); // ensure result view always shows
      setProgress({ percentage: 1, itemsProcessed: 1 });
      setTimeout(() => {
        stopProgress();
      }, 500);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError(`Failed to generate CSV: ${err.message}`);
      }
      stopProgress();
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  // ── Multi-rubric batch generation ────────────────────────────────────

  const handleGenerateAll = async () => {
    if (attachments.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsGeneratingAll(true);
    setError(null);
    // Show a single "generating" placeholder card while the batch call runs
    setRubricResults([{ rubric: { name: 'All rubrics', totalPoints: '', scoringMethod: 'fixed' }, status: 'generating' }]);

    try {
      const batchResults = await generateAllCsvsFromDoc(attachments[0], controller.signal);

      if (controller.signal.aborted) return;

      // Populate rubricOptions so SINGLE mode and retry can reference them
      const metas = batchResults.map((r) => ({
        name: r.title,
        totalPoints: '',
        scoringMethod: 'fixed' as const,
      }));
      setRubricOptions(metas);
      setRubricResults(
        batchResults.map((r, i) => ({
          rubric: metas[i],
          status: 'done',
          csvContent: r.csv,
        })),
      );
    } catch (err: any) {
      if (!controller.signal.aborted) {
        setError(`Batch generation failed: ${err.message}`);
        setRubricResults([]);
      }
    }

    setIsGeneratingAll(false);
    abortRef.current = null;
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGeneratingAll(false);
    setIsLoading(false);
    stopProgress();
  };

  /** Retry a single failed rubric without re-running the whole batch. */
  const handleRetryRubric = async (index: number) => {
    const rubric = rubricOptions[index];
    if (!rubric || attachments.length === 0) return;

    // Mark just this one rubric as generating again
    setRubricResults((prev) => {
      const next = [...prev];
      next[index] = { rubric, status: 'generating' };
      return next;
    });

    try {
      // No shared abort controller — individual retries run independently.
      // The queue-based throttle serialises them with any ongoing batch.
      const csv = await generateCsvForRubric(
        rubric.name,
        rubric.totalPoints,
        rubric.scoringMethod,
        attachments[0],
      );
      setRubricResults((prev) => {
        const next = [...prev];
        next[index] = { rubric, status: 'done', csvContent: csv };
        return next;
      });
    } catch (err: any) {
      setRubricResults((prev) => {
        const next = [...prev];
        next[index] = { rubric, status: 'error', error: err.message };
        return next;
      });
    }
  };

  /** Zip all successfully generated CSVs and trigger a single download. */
  const handleDownloadAllZip = async () => {
    const completed = rubricResults.filter(
      (r) => r.status === 'done' && r.csvContent,
    );
    if (completed.length === 0) return;

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    for (const result of completed) {
      // Sanitise name — remove characters that are illegal in filenames
      const safeName = result.rubric.name
        .replace(/[/\\?%*:|"<>]/g, '_')
        .trim();
      zip.file(`${safeName}.csv`, result.csvContent!);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'all-rubrics.zip');
  };

  // ── Other handlers ────────────────────────────────────────────────────

  const handleCopyToClipboard = () => {
    if (singleCsvContent) {
      navigator.clipboard.writeText(singleCsvContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleContinuePart3 = () => {
    if (!singleCsvContent) {
      setError('Please generate a CSV first');
      return;
    }
    setCurrentStep(AppMode.PART_3);
  };

  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveSaveSuccess, setDriveSaveSuccess] = useState<string | null>(null);
  const [savingAllToDrive, setSavingAllToDrive] = useState(false);
  const [driveAllSaveSuccess, setDriveAllSaveSuccess] = useState<string | null>(null);

  const handleSaveAllToDrive = async () => {
    if (!state.googleAccessToken) return;
    const completed = rubricResults.filter(r => r.status === 'done' && r.csvContent);
    if (completed.length === 0) return;
    setSavingAllToDrive(true);
    setDriveAllSaveSuccess(null);
    try {
      const folder = await googleDriveService.openFolderPicker(state.googleAccessToken);
      if (!folder) { setSavingAllToDrive(false); return; }

      for (const result of completed) {
        await googleDriveService.uploadFileToDrive(
          state.googleAccessToken,
          result.csvContent!,
          result.rubric.name,
          'text/csv',
          'application/vnd.google-apps.spreadsheet',
          folder.folderId,
        );
      }
      setDriveAllSaveSuccess(`${completed.length} file${completed.length !== 1 ? 's' : ''} saved to "${folder.folderName}"`);
    } catch (err: any) {
      setError(`Google Drive save failed: ${err.message}`);
    } finally {
      setSavingAllToDrive(false);
    }
  };

  const handleSaveToDrive = async () => {
    if (!singleCsvContent || !state.googleAccessToken) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    try {
      const folder = await googleDriveService.openFolderPicker(state.googleAccessToken);
      if (!folder) { setSavingToDrive(false); return; }

      const filename = editableRubricName || state.csvFileName?.replace(/\.csv$/i, '') || 'rubric';
      await googleDriveService.uploadFileToDrive(
        state.googleAccessToken,
        singleCsvContent,
        filename,
        'text/csv',
        'application/vnd.google-apps.spreadsheet',
        folder.folderId,
      );
      setDriveSaveSuccess(`Saved to "${folder.folderName}"`);
    } catch (err: any) {
      setError(`Google Drive save failed: ${err.message}`);
    } finally {
      setSavingToDrive(false);
    }
  };

  const handleFetchGoogleSheet = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google first');
      return;
    }
    if (!googleSheetUrl.trim()) {
      setError('Please enter a Google Sheets URL');
      return;
    }

    setFetchingGoogleSheet(true);
    setError(null);

    try {
      const csvData = await extractGoogleSheetCsv(googleSheetUrl);
      setSingleCsvContent(csvData);
      setCsvOutput(csvData, 'imported-sheet.csv');
      setProcessingType(ProcessingType.SINGLE); // ensure result view shows
      setGoogleSheetUrl('');
      setInputMode('file');
    } catch (err: any) {
      setError(`Failed to fetch Google Sheet: ${err.message}`);
    } finally {
      setFetchingGoogleSheet(false);
    }
  };

  /** Open the Google Drive file picker filtered to Sheets, fetch the chosen sheet as CSV. */
  const handlePickerOpen = async () => {
    if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
      setError('Please sign in with Google first.');
      return;
    }
    setPickingFromDrive(true);
    setError(null);
    try {
      const result = await googleDriveService.openPicker(
        state.googleAccessToken,
        ['application/vnd.google-apps.spreadsheet'],
      );
      if (result) {
        setFetchingGoogleSheet(true);
        const csvData = await googleDriveService.getGoogleSheetContent(
          result.fileId,
          state.googleAccessToken,
        );
        setSingleCsvContent(csvData);
        setCsvOutput(csvData, `${result.name}.csv`);
        setProcessingType(ProcessingType.SINGLE);
        setInputMode('file'); // switch back so the result panel shows
      }
    } catch (err: any) {
      setError(`Google Drive: ${err.message}`);
    } finally {
      setPickingFromDrive(false);
      setFetchingGoogleSheet(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────

  const doneCount = rubricResults.filter((r) => r.status === 'done').length;
  const errorCount = rubricResults.filter((r) => r.status === 'error').length;
  const totalCount = rubricResults.length;
  const completedCount = doneCount + errorCount;

  // Batch call: single Gemini request for the whole document (~60 s typical)
  const staticEstimateSecs = 60;

  // For batch mode, estimate remaining time relative to the 60 s budget
  const dynamicRemainingS = Math.max(0, staticEstimateSecs - elapsedSeconds);

  /** Format seconds as "Xm Ys" or just "Xs" */
  const fmtSeconds = (s: number) => {
    if (s < 0) return '0s';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const progressPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center py-8">
      {/* About Phase 2 - Above Main Section */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 max-w-2xl w-full">
        <h3 className="text-sm font-black text-gray-900 mb-1">About Phase 2</h3>
        <p className="text-sm text-gray-700">
          Upload or paste one or more draft rubrics to transform them into Canvas-compatible CSV rubric files. Draft rubrics can be in MS Word, Google Docs, or PDF format.
        </p>
      </div>

      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">

        {/* ══ SINGLE-RUBRIC RESULT VIEW ══════════════════════════════════ */}
        {singleCsvContent && processingType === ProcessingType.SINGLE ? (
          <>
            {/* Success banner — matches Phase 1 style */}
            <div className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-black text-green-900">✓ Canvas CSV Generated!</p>
                  <p className="text-sm text-green-700">Your CSV rubric is ready to be uploaded to Canvas.</p>
                </div>
              </div>
            </div>

            {/* Rubric name — prefer editable name, fall back to CSV filename */}
            {(editableRubricName || state.csvFileName) && (
              <div className="mb-4">
                <h3 className="text-xl font-black text-gray-900">
                  {editableRubricName || state.csvFileName?.replace(/\.csv$/i, '')}
                </h3>
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Generated CSV
              </label>
              <div className="p-4 bg-gray-50 border rounded-2xl max-h-48 overflow-auto">
                <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-mono">
                  {singleCsvContent}
                </pre>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() =>
                  downloadCsv(singleCsvContent, editableRubricName || 'rubric')
                }
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download as .csv
              </button>
              <button
                onClick={handleSaveToDrive}
                disabled={savingToDrive || !state.isGoogleAuthenticated}
                className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {savingToDrive ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
                  </svg>
                )}
                {savingToDrive ? 'Adding…' : 'Add to Drive'}
              </button>
              <button
                onClick={handleContinuePart3}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
              >
                Carry CSV to Phase 3
              </button>
            </div>
            {driveSaveSuccess && (
              <p className="text-xs text-green-700 font-bold text-center mt-2">✓ {driveSaveSuccess}</p>
            )}

            <div className="flex flex-col gap-2 mt-3">
              <button
                onClick={resetForNewFile}
                className="w-full py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 hover:brightness-110 transition-all"
              >
                Convert Another File
              </button>
              <button
                onClick={() => setCurrentStep(AppMode.PART_1)}
                className="w-full py-2 px-4 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Phase 1
              </button>
            </div>
          </>
        ) : (
          /* ══ UPLOAD / GENERATION FORM ══════════════════════════════════ */
          <>
            <h2 className="text-2xl font-black text-gray-900 mb-6">Convert to CSV</h2>

            {/* Upload Mode Tabs */}
            <div className="mb-6 border-b border-gray-200 flex gap-0">
              <button
                onClick={() => setInputMode('from-phase1')}
                className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
                  inputMode === 'from-phase1'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                From Phase 1
              </button>
              <button
                onClick={() => { setInputMode('file'); setGoogleSheetUrl(''); setError(null); }}
                className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
                  inputMode === 'file'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Local Drive
              </button>
              <button
                onClick={() => { setInputMode('google-sheet'); setError(null); }}
                className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
                  inputMode === 'google-sheet'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Google Drive
              </button>
            </div>

            {/* From Phase 1 tab content */}
            {inputMode === 'from-phase1' && (
              fromPhase1 ? (
                <div>
                  {/* Banner */}
                  <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4">
                    <p className="font-bold text-green-900 text-sm">Rubric from Phase 1 is ready</p>
                    <p className="text-xs text-green-800 mt-0.5">
                      Review the settings below and click Generate — no file upload needed.
                    </p>
                  </div>
                  {/* Pre-filled form */}
                  <div className="p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-4">
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1">Rubric Name</label>
                      <input
                        value={editableRubricName}
                        onChange={(e) => setEditableRubricName(e.target.value)}
                        className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-2">Scoring Method</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            value="ranges"
                            checked={editableScoringMethod === 'ranges'}
                            onChange={() => setEditableScoringMethod('ranges')}
                            className="w-4 h-4 accent-blue-600"
                          />
                          <span className="text-sm text-gray-700">Point Ranges</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            value="fixed"
                            checked={editableScoringMethod === 'fixed'}
                            onChange={() => setEditableScoringMethod('fixed')}
                            className="w-4 h-4 accent-blue-600"
                          />
                          <span className="text-sm text-gray-700">Fixed Points</span>
                        </label>
                      </div>
                    </div>
                    <button
                      onClick={handleGenerateFromPhase1}
                      disabled={!editableRubricName.trim()}
                      className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-300 transition-all flex items-center justify-center gap-2"
                    >
                      <Zap className="w-4 h-4" />
                      Generate Canvas CSV from Phase 1 Rubric
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-5 bg-yellow-50 border border-yellow-200 rounded-2xl text-center">
                  <p className="text-sm font-bold text-yellow-900">No content from Phase 1 yet.</p>
                  <p className="text-xs text-yellow-700 mt-2">
                    Go to Phase 1 first to create a draft rubric, then return here to convert it.
                  </p>
                </div>
              )
            )}

            {/* Local Drive / Google Drive tab content */}
            {(inputMode === 'file' || inputMode === 'google-sheet') && (<>

            {inputMode === 'file' ? (
              <>
                {/* Step 1 label */}
                <p className="text-xs font-bold text-[#1d6f42] uppercase tracking-wider mb-3">
                  Step 1: Upload Draft Rubric (Word/PDF)
                </p>

                {attachments.length === 0 ? (
                  /* ── Drop zone ─────────────────────────────────────── */
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative w-full p-8 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                      isDragging
                        ? 'bg-blue-50 border-blue-400'
                        : 'bg-gray-50 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Upload className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="text-sm font-bold text-gray-700">
                      Drop file here or click to browse
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc"
                      onChange={(e) => {
                        if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
                      }}
                      className="hidden"
                    />
                  </div>
                ) : (
                  /* ── File selected ─────────────────────────────────── */
                  <>
                    {/* File indicator */}
                    <div className="p-4 bg-green-50 border border-green-200 rounded-2xl mb-4">
                      <p className="text-sm font-bold text-green-900">
                        ✓ {attachments[0].name}
                      </p>
                    </div>

                    {/* Rubric Details section ──────────────────────────── */}
                    {attachments.length > 0 && (
                      <>
                        <div className="mt-8 mb-4 border-t border-gray-100 pt-6">
                          <h3 className="text-lg font-black text-gray-900">
                            Rubric Details
                          </h3>
                        </div>

                        {/* Document Contains radio */}
                        <div className="mb-6">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                            Document Contains
                          </p>
                          <div className="flex gap-3">
                            <label
                              className={`flex items-center gap-2 cursor-pointer px-4 py-3 rounded-xl border-2 flex-1 transition-all ${
                                processingType === ProcessingType.SINGLE
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-200 bg-white hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="radio"
                                checked={processingType === ProcessingType.SINGLE}
                                onChange={() => setProcessingType(ProcessingType.SINGLE)}
                                className="w-4 h-4 accent-blue-600"
                              />
                              <span className="text-sm font-bold text-gray-800">
                                Single Rubric
                              </span>
                            </label>
                            <label
                              className={`flex items-center gap-2 cursor-pointer px-4 py-3 rounded-xl border-2 flex-1 transition-all ${
                                processingType === ProcessingType.MULTIPLE
                                  ? 'border-blue-500 bg-blue-50'
                                  : 'border-gray-200 bg-white hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="radio"
                                checked={processingType === ProcessingType.MULTIPLE}
                                onChange={() =>
                                  setProcessingType(ProcessingType.MULTIPLE)
                                }
                                className="w-4 h-4 accent-blue-600"
                              />
                              <span className="text-sm font-bold text-gray-800">
                                Multiple Rubrics
                              </span>
                            </label>
                          </div>
                        </div>

                        {processingType === ProcessingType.SINGLE ? (
                          /* ── Single rubric editable form ─────────────── */
                          <>
                            <div className="border-t border-gray-100 pt-6 mb-4">
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
                                Step 2: Confirm Details
                              </p>
                            </div>

                            {/* Rubric selector (only when multiple rubrics found) */}
                            {rubricOptions.length > 1 && (
                              <div className="mb-4">
                                <label className="block text-sm font-bold text-gray-700 mb-3">
                                  Select rubric:
                                </label>
                                <div className="space-y-2">
                                  {rubricOptions.map((rubric, i) => (
                                    <label
                                      key={i}
                                      className="flex items-center p-3 border rounded-xl cursor-pointer hover:bg-blue-50"
                                    >
                                      <input
                                        type="radio"
                                        checked={editableRubricName === rubric.name}
                                        onChange={() => {
                                          setEditableRubricName(rubric.name);
                                          setEditableTotalPoints(rubric.totalPoints);
                                          setEditableScoringMethod(rubric.scoringMethod);
                                        }}
                                        className="w-4 h-4 accent-blue-600"
                                      />
                                      <span className="ml-3 font-bold text-gray-900">
                                        {rubric.name}
                                      </span>
                                      <span className="ml-auto text-xs text-gray-500">
                                        {rubric.totalPoints} pts
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Editable fields */}
                            <div className="mb-4">
                              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                Rubric Name
                              </label>
                              <input
                                type="text"
                                value={editableRubricName}
                                onChange={(e) => setEditableRubricName(e.target.value)}
                                placeholder="Suggested Name"
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-gray-50 focus:bg-white transition-colors"
                              />
                            </div>
                            <div className="mb-4">
                              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                                Total Points
                              </label>
                              <input
                                type="text"
                                value={editableTotalPoints}
                                onChange={(e) => setEditableTotalPoints(e.target.value)}
                                placeholder="Suggested Points"
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-gray-50 focus:bg-white transition-colors"
                              />
                            </div>
                            <div className="mb-6">
                              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                                Scoring Method
                              </label>
                              <div className="flex gap-6">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={editableScoringMethod === 'ranges'}
                                    onChange={() => setEditableScoringMethod('ranges')}
                                    className="w-4 h-4 accent-blue-600"
                                  />
                                  <span className="text-sm font-bold text-gray-700">
                                    Ranges
                                  </span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    checked={editableScoringMethod === 'fixed'}
                                    onChange={() => setEditableScoringMethod('fixed')}
                                    className="w-4 h-4 accent-blue-600"
                                  />
                                  <span className="text-sm font-bold text-gray-700">
                                    Fixed
                                  </span>
                                </label>
                              </div>
                            </div>

                            {state.error && (
                              <ErrorDisplay error={state.error} className="mb-6" />
                            )}

                            {/* Generate / Stop button */}
                            <button
                              onClick={state.isLoading ? handleStop : handleGenerateSingle}
                              disabled={
                                !state.isLoading &&
                                (!editableRubricName.trim() || attachments.length === 0)
                              }
                              className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ${
                                state.isLoading
                                  ? 'bg-red-500 text-white hover:bg-red-600'
                                  : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400'
                              }`}
                            >
                              {state.isLoading ? (
                                <>
                                  <StopCircle className="w-5 h-5" />
                                  Stop Generation
                                </>
                              ) : (
                                'Generate Canvas CSV'
                              )}
                            </button>

                            {state.isLoading && (
                              <p className="text-xs text-center text-gray-500 mt-3 animate-pulse">
                                ⏱ Generating your CSV — this usually takes 15–30 seconds
                              </p>
                            )}
                          </>
                        ) : (
                          /* ── Multiple rubrics flow ───────────────────── */
                          <>
                            <div className="border-t border-gray-100 pt-6 mb-4">
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
                                Step 2: Generate All CSVs
                              </p>
                              <p className="text-xs text-gray-500">
                                {rubricResults.length > 0 && !isGeneratingAll
                                  ? `${rubricResults.length} rubric${rubricResults.length !== 1 ? 's' : ''} extracted — download individually or as a ZIP.`
                                  : 'All rubric tables in the document will be sent to Gemini in a single request and split into separate Canvas CSV files.'}
                              </p>
                            </div>

                            {/* Download All ZIP + Save All to Drive — sits above the cards once at least one is done */}
                            {doneCount > 0 && (
                              <>
                                <div className="flex gap-3 mb-4">
                                  <button
                                    onClick={handleDownloadAllZip}
                                    className="flex-1 py-3 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                                  >
                                    <PackageOpen className="w-5 h-5" />
                                    Download All {doneCount} as ZIP
                                  </button>
                                  <button
                                    onClick={handleSaveAllToDrive}
                                    disabled={savingAllToDrive || !state.isGoogleAuthenticated}
                                    className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 rounded-2xl font-black uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
                                  >
                                    {savingAllToDrive ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
                                      </svg>
                                    )}
                                    {savingAllToDrive ? 'Adding…' : `Add All ${doneCount} to Drive`}
                                  </button>
                                </div>
                                {driveAllSaveSuccess && (
                                  <p className="text-xs text-green-700 font-bold text-center -mt-2 mb-3">✓ {driveAllSaveSuccess}</p>
                                )}
                              </>
                            )}

                            {/* Per-rubric result cards */}
                            {rubricResults.length > 0 && (
                              <div className="space-y-2 mb-5">
                                {rubricResults.map((result, i) => (
                                  <div
                                    key={i}
                                    className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                                      result.status === 'done'
                                        ? 'bg-green-50 border-green-200'
                                        : result.status === 'error'
                                        ? 'bg-red-50 border-red-200'
                                        : result.status === 'generating'
                                        ? 'bg-blue-50 border-blue-200'
                                        : 'bg-gray-50 border-gray-200'
                                    }`}
                                  >
                                    {/* Status icon */}
                                    {result.status === 'done' && (
                                      <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                                    )}
                                    {result.status === 'error' && (
                                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                    )}
                                    {result.status === 'generating' && (
                                      <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                                    )}
                                    {result.status === 'pending' && (
                                      <Clock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                    )}

                                    {/* Labels */}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-gray-900 truncate">
                                        {result.rubric.name}
                                      </p>
                                      {result.status === 'generating' && (
                                        <p className="text-xs text-blue-600 mt-0.5">
                                          Generating…
                                        </p>
                                      )}
                                      {result.status === 'error' && result.error && (
                                        <RubricErrorLine error={result.error} />
                                      )}
                                    </div>

                                    <span className="text-xs text-gray-500 flex-shrink-0">
                                      {result.rubric.totalPoints} pts
                                    </span>

                                    {/* Per-rubric action buttons */}
                                    {result.status === 'done' && result.csvContent && (
                                      <button
                                        onClick={() =>
                                          downloadCsv(result.csvContent!, result.rubric.name)
                                        }
                                        className="flex-shrink-0 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition-all flex items-center gap-1.5"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                        Download
                                      </button>
                                    )}
                                    {result.status === 'error' && (
                                      <button
                                        onClick={() => handleRetryRubric(i)}
                                        className="flex-shrink-0 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 transition-all flex items-center gap-1.5"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        Retry
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Progress summary + live ETA (shown while generating) */}
                            {isGeneratingAll && (
                              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                                {/* Counts row */}
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-blue-800 font-semibold">
                                    {completedCount} of {totalCount} completed
                                    {errorCount > 0 && (
                                      <span className="text-red-600 ml-1">
                                        · {errorCount} error{errorCount !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                  </p>
                                  <span className="text-xs font-bold text-blue-700">
                                    {progressPct}%
                                  </span>
                                </div>

                                {/* Progress bar */}
                                <div className="w-full bg-blue-200 rounded-full h-1.5">
                                  <div
                                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-700"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>

                                {/* Time row */}
                                <div className="flex items-center justify-between text-xs text-blue-600">
                                  <span>⏱ Elapsed: {fmtSeconds(elapsedSeconds)}</span>
                                  {dynamicRemainingS > 0 ? (
                                    <span>
                                      ~{fmtSeconds(dynamicRemainingS)} remaining
                                    </span>
                                  ) : (
                                    <span className="text-green-600 font-semibold">Wrapping up…</span>
                                  )}
                                </div>

                                <p className="text-xs text-blue-500">
                                  Sending all rubrics in one request — this may take up to 60 s
                                </p>
                              </div>
                            )}

                            {/* Post-generation summary (after batch finishes) */}
                            {!isGeneratingAll && totalCount > 0 && completedCount === totalCount && (
                              <div className={`mb-4 p-3 rounded-xl border ${errorCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                                <p className={`text-sm font-semibold ${errorCount > 0 ? 'text-amber-800' : 'text-green-800'}`}>
                                  {doneCount} of {totalCount} succeeded
                                  {errorCount > 0 && ` · ${errorCount} failed — use Retry on individual items`}
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  Total time: {fmtSeconds(elapsedSeconds)}
                                  {doneCount > 0 && ` · avg ${(elapsedSeconds / doneCount).toFixed(1)}s per rubric`}
                                </p>
                              </div>
                            )}

                            {state.error && (
                              <ErrorDisplay error={state.error} className="mb-5" />
                            )}

                            {/* Primary CTA: Continue to Phase 3 when all done */}
                            {doneCount > 0 && !isGeneratingAll && errorCount === 0 && doneCount === totalCount && (
                              <button
                                onClick={() => setCurrentStep(AppMode.PART_3)}
                                className="w-full py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-95 bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center gap-2"
                              >
                                Carry CSV to Phase 3 →
                              </button>
                            )}

                            {/* Generate All / Stop button */}
                            {(() => {
                              const allDone =
                                doneCount > 0 &&
                                !isGeneratingAll &&
                                errorCount === 0 &&
                                doneCount === totalCount;
                              return (
                                <button
                                  onClick={isGeneratingAll ? handleStop : handleGenerateAll}
                                  disabled={!isGeneratingAll && attachments.length === 0}
                                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ${
                                    isGeneratingAll
                                      ? 'bg-red-500 text-white hover:bg-red-600'
                                      : allDone
                                      ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 shadow-none'
                                      : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400'
                                  }`}
                                >
                                  {isGeneratingAll ? (
                                    <>
                                      <StopCircle className="w-5 h-5" />
                                      Stop Generation
                                    </>
                                  ) : allDone ? (
                                    `Re-generate All ${doneCount} CSVs`
                                  ) : (
                                    'Generate All CSVs'
                                  )}
                                </button>
                              );
                            })()}

                            {/* Pre-generation estimate (before clicking Generate) */}
                            {!isGeneratingAll && completedCount < totalCount && totalCount > 0 && (
                              <p className="text-xs text-center text-gray-400 mt-3">
                                ⏱ Estimated time: ~{fmtSeconds(staticEstimateSecs)}–{fmtSeconds(Math.round(staticEstimateSecs * 1.4))}
                              </p>
                            )}
                          </>
                        )}

                        {/* Choose different file / Back to Phase 1 */}
                        <div className="flex flex-col gap-2 mt-3">
                          <button
                            onClick={resetForNewFile}
                            className="w-full py-2 text-gray-500 rounded-xl font-bold hover:bg-gray-100 hover:brightness-110 transition-all text-sm"
                          >
                            Choose Different File
                          </button>
                          <button
                            onClick={() => setCurrentStep(AppMode.PART_1)}
                            className="w-full py-2 px-4 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 hover:brightness-110 transition-all flex items-center justify-center gap-2"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            Back to Phase 1
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              /* ── Google Drive / Sheets input ─────────────────────────── */
              <>
                {/* Primary: Drive Picker */}
                <button
                  onClick={handlePickerOpen}
                  disabled={pickingFromDrive || fetchingGoogleSheet || !state.isGoogleAuthenticated}
                  className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-all flex items-center justify-center gap-2"
                >
                  {(pickingFromDrive || fetchingGoogleSheet) ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderOpen className="w-4 h-4" />
                  )}
                  {pickingFromDrive
                    ? 'Opening Drive…'
                    : fetchingGoogleSheet
                    ? 'Fetching Sheet…'
                    : 'Pick from Google Drive'}
                </button>

                {!state.isGoogleAuthenticated && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-3">
                    <p className="text-sm font-bold text-gray-700 mb-1">Google sign-in required</p>
                    <p className="text-xs text-gray-500 mb-3">Sign in to pick files directly from your Drive.</p>
                    <button
                      onClick={() => startGoogleAuth()}
                      className="w-full py-2.5 px-4 bg-white border border-gray-300 rounded-lg font-bold text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Sign in with Google
                    </button>
                  </div>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400 font-semibold">OR</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Fallback: URL input */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Paste Google Sheets URL
                  </label>
                  <input
                    type="url"
                    value={googleSheetUrl}
                    onChange={(e) => setGoogleSheetUrl(e.target.value)}
                    placeholder="docs.google.com/spreadsheets/d/…"
                    className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                  />
                  <button
                    onClick={handleFetchGoogleSheet}
                    disabled={
                      !googleSheetUrl.trim() ||
                      fetchingGoogleSheet ||
                      pickingFromDrive ||
                      !state.isGoogleAuthenticated
                    }
                    className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    {fetchingGoogleSheet && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    {fetchingGoogleSheet ? 'Fetching…' : 'Fetch Sheet'}
                  </button>
                </div>

                {state.error && (
                  <ErrorDisplay error={state.error} className="mt-6" />
                )}
              </>
            )}
            </>)}
          </>
        )}
      </div>
    </div>
  );
};

