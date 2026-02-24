import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, Attachment, RubricMeta, ProcessingType } from '../types';
import {
  extractRubricMetadata,
  generateCsvForRubric,
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
} from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';


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
  } = useSession();

  // ── File / attachment state ──────────────────────────────────────────
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [rubricOptions, setRubricOptions] = useState<RubricMeta[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Input mode (file upload vs Google Sheets) ────────────────────────
  const [inputMode, setInputMode] = useState<'file' | 'google-sheet'>('file');
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [fetchingGoogleSheet, setFetchingGoogleSheet] = useState(false);

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
    setIsLoading(true);

    try {
      const isDocx = file.name.endsWith('.docx') || file.name.endsWith('.doc');
      const isPdf = file.name.endsWith('.pdf');

      if (!isDocx && !isPdf) {
        setError('Please upload a Word (.docx) or PDF file');
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const base64Data = btoa(
        String.fromCharCode(...new Uint8Array(arrayBuffer)),
      );
      const mimeType = isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      const attachment: Attachment = { name: file.name, mimeType, data: base64Data };
      setAttachments([attachment]);

      setAnalyzing(true);
      const rubrics = await extractRubricMetadata([attachment]);
      setRubricOptions(rubrics);

      if (rubrics.length === 0) {
        setError('No rubric found in the file. Please ensure it contains a rubric table.');
      } else {
        // Pre-populate editable fields from the first rubric
        setEditableRubricName(rubrics[0].name);
        setEditableTotalPoints(rubrics[0].totalPoints);
        setEditableScoringMethod(rubrics[0].scoringMethod);
        // Default to multiple mode when >1 rubric detected
        const defaultMode =
          rubrics.length > 1 ? ProcessingType.MULTIPLE : ProcessingType.SINGLE;
        setProcessingType(defaultMode);
        // Initialise result cards
        setRubricResults(rubrics.map((r) => ({ rubric: r, status: 'pending' })));
      }
    } catch (err: any) {
      setError(`Error processing file: ${err.message}`);
    } finally {
      setAnalyzing(false);
      setIsLoading(false);
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
      setProgress({ percentage: 1, itemsProcessed: 1 });
      setTimeout(() => {
        stopProgress();
        setTaskCompletionOpen(true);
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

  // ── Multi-rubric parallel generation ─────────────────────────────────

  const handleGenerateAll = async () => {
    if (attachments.length === 0 || rubricOptions.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsGeneratingAll(true);
    setError(null);

    // Mark every rubric as "generating" — the queue-based throttle in
    // geminiService serialises the actual API calls one at a time.
    setRubricResults(rubricOptions.map((r) => ({ rubric: r, status: 'generating' })));

    await Promise.allSettled(
      rubricOptions.map((rubric, i) =>
        generateCsvForRubric(
          rubric.name,
          rubric.totalPoints,
          rubric.scoringMethod,
          attachments[0],
          controller.signal,
        )
          .then((csv) => {
            setRubricResults((prev) => {
              const next = [...prev];
              next[i] = { rubric, status: 'done', csvContent: csv };
              return next;
            });
          })
          .catch((err) => {
            const errorMsg = controller.signal.aborted
              ? 'Generation stopped'
              : err.message;
            setRubricResults((prev) => {
              const next = [...prev];
              next[i] = { rubric, status: 'error', error: errorMsg };
              return next;
            });
          }),
      ),
    );

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

  // ── Derived values ────────────────────────────────────────────────────

  const doneCount = rubricResults.filter((r) => r.status === 'done').length;
  const errorCount = rubricResults.filter((r) => r.status === 'error').length;
  const totalCount = rubricResults.length;
  const completedCount = doneCount + errorCount;

  // Static upper-bound estimate (10 s throttle gap + ~15 s avg API response)
  const PER_ITEM_ESTIMATE_S = 25;
  const staticEstimateSecs = rubricOptions.length * PER_ITEM_ESTIMATE_S;

  // Dynamic average: seconds elapsed divided by items completed
  const avgSecsPerItem =
    completedCount > 0 ? elapsedSeconds / completedCount : PER_ITEM_ESTIMATE_S;

  // Items still in flight (generating or pending)
  const remainingItems = totalCount - completedCount;
  const dynamicRemainingS = Math.round(remainingItems * avgSecsPerItem);

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
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">
        <h2 className="text-2xl font-black text-gray-900 mb-1">Rubric Setup</h2>
        <p className="text-gray-500 text-sm mb-8">
          Please provide the details for your rubric.
        </p>

        {/* ══ SINGLE-RUBRIC RESULT VIEW ══════════════════════════════════ */}
        {singleCsvContent && processingType === ProcessingType.SINGLE ? (
          <>
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
                onClick={handleCopyToClipboard}
                className="flex-1 px-4 py-3 bg-gray-600 text-white rounded-xl font-bold hover:bg-gray-700 transition-all flex items-center justify-center gap-2"
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() =>
                  downloadCsv(singleCsvContent, editableRubricName || 'rubric')
                }
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Download
              </button>
              <button
                onClick={handleContinuePart3}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all"
              >
                Continue to Part 3
              </button>
            </div>

            <button
              onClick={resetForNewFile}
              className="w-full mt-3 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
            >
              Convert Another File
            </button>
          </>
        ) : (
          /* ══ UPLOAD / GENERATION FORM ══════════════════════════════════ */
          <>
            {/* Tab bar ──────────────────────────────────────────────────── */}
            <div className="flex gap-3 mb-6 border-b border-gray-200">
              <button
                onClick={() => {
                  setInputMode('file');
                  setGoogleSheetUrl('');
                  setError(null);
                }}
                className={`px-4 py-3 font-bold border-b-2 transition-all flex items-center gap-2 ${
                  inputMode === 'file'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Upload className="w-4 h-4" />
                Upload File
              </button>
              <button
                onClick={() => {
                  setInputMode('google-sheet');
                  setError(null);
                }}
                className={`px-4 py-3 font-bold border-b-2 transition-all flex items-center gap-2 ${
                  inputMode === 'google-sheet'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <LinkIcon className="w-4 h-4" />
                Google Sheets URL
              </button>
            </div>

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

                    {/* Analysing spinner */}
                    {analyzing && (
                      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-2xl mb-6">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-blue-800">
                            Scanning document for rubric details…
                          </p>
                          <p className="text-xs text-blue-500 mt-0.5">
                            This usually takes 5–15 seconds
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Rubric Details section ──────────────────────────── */}
                    {rubricOptions.length > 0 && !analyzing && (
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
                                analyzing ||
                                (!state.isLoading &&
                                  (!editableRubricName.trim() ||
                                    attachments.length === 0))
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
                                <>
                                  {analyzing && (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                  )}
                                  {analyzing ? 'Scanning Document…' : 'Generate Canvas CSV'}
                                </>
                              )}
                            </button>

                            {state.isLoading && !analyzing && (
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
                                {rubricOptions.length} rubric
                                {rubricOptions.length !== 1 ? 's' : ''} detected — each
                                will be converted to a separate Canvas CSV file.
                              </p>
                            </div>

                            {/* Download All ZIP — sits above the cards once at least one is done */}
                            {doneCount > 0 && (
                              <button
                                onClick={handleDownloadAllZip}
                                className="w-full mb-4 py-3 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-green-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                              >
                                <PackageOpen className="w-5 h-5" />
                                Download All {doneCount} CSV{doneCount !== 1 ? 's' : ''} as ZIP
                              </button>
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
                                  {remainingItems > 0 ? (
                                    <span>
                                      ~{fmtSeconds(dynamicRemainingS)} remaining
                                    </span>
                                  ) : (
                                    <span className="text-green-600 font-semibold">Wrapping up…</span>
                                  )}
                                </div>

                                <p className="text-xs text-blue-500">
                                  Requests are spaced 10 s apart to respect API rate limits
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

                            {/* Generate All / Stop button
                                Grey out once every rubric has been attempted
                                (all are either done or error — nothing left to run). */}
                            {(() => {
                              const allAttempted =
                                totalCount > 0 &&
                                !isGeneratingAll &&
                                doneCount + errorCount === totalCount;
                              return (
                                <button
                                  onClick={isGeneratingAll ? handleStop : handleGenerateAll}
                                  disabled={
                                    analyzing ||
                                    allAttempted ||
                                    (!isGeneratingAll && rubricOptions.length === 0)
                                  }
                                  className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 ${
                                    isGeneratingAll
                                      ? 'bg-red-500 text-white hover:bg-red-600'
                                      : allAttempted
                                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                      : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400'
                                  }`}
                                >
                                  {isGeneratingAll ? (
                                    <>
                                      <StopCircle className="w-5 h-5" />
                                      Stop Generation
                                    </>
                                  ) : (
                                    rubricOptions.length > 1
                                      ? `Generate All ${rubricOptions.length} CSVs`
                                      : 'Generate Canvas CSV'
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

                        {/* Choose different file */}
                        <button
                          onClick={resetForNewFile}
                          className="w-full mt-3 py-2 text-gray-500 rounded-xl font-bold hover:bg-gray-100 transition-all text-sm"
                        >
                          Choose Different File
                        </button>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              /* ── Google Sheets input ────────────────────────────────── */
              <>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Google Sheets URL
                  </label>
                  <input
                    type="url"
                    value={googleSheetUrl}
                    onChange={(e) => setGoogleSheetUrl(e.target.value)}
                    placeholder="Paste your shared Google Sheets link (docs.google.com/spreadsheets/d/...)"
                    className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                  />
                  <p className="text-xs text-gray-500 mb-4">
                    The sheet must be shared with your Google account.
                  </p>
                  <button
                    onClick={handleFetchGoogleSheet}
                    disabled={
                      !googleSheetUrl.trim() ||
                      fetchingGoogleSheet ||
                      !state.isGoogleAuthenticated
                    }
                    className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    {fetchingGoogleSheet && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    {fetchingGoogleSheet ? 'Fetching Sheet…' : 'Fetch Sheet'}
                  </button>

                  {fetchingGoogleSheet && (
                    <p className="text-xs text-center text-gray-500 mt-2 animate-pulse">
                      ⏱ Fetching sheet data — this usually takes 5–10 seconds
                    </p>
                  )}

                  {!state.isGoogleAuthenticated && (
                    <p className="text-xs text-red-600 mt-3 font-bold">
                      Please sign in with Google on the Dashboard first to use this
                      feature.
                    </p>
                  )}
                </div>

                {state.error && (
                  <ErrorDisplay error={state.error} className="mt-6" />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

