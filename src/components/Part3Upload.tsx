import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, CanvasConfig } from '../types';
import { pushRubricToCanvas } from '../services/canvasService';
import { analyzeCsvForCanvas, CsvAnalysisResult } from '../services/geminiService';
import { Eye, EyeOff, Loader2, Upload, CheckCircle, AlertCircle, X, Info, Zap, ScanSearch } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import JSZip from 'jszip';

interface BatchFile {
  id: string;
  name: string;
  content: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  message?: string;
}

export const Part3Upload: React.FC = () => {
  const {
    state,
    setCsvOutput,
    setCanvasConfig,
    setError,
    setIsLoading,
    addToHistory,
    setTaskCompletionOpen,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
  } = useSession();

  const [courseUrl, setCourseUrl] = useState('');
  const [courseId, setCourseId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [manualCsv, setManualCsv] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single');
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);
  const [tunnelTested, setTunnelTested] = useState(false);
  const [analysisMap, setAnalysisMap] = useState<Record<string, CsvAnalysisResult | 'analyzing' | 'error'>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  const csvToUse = state.csvOutput || manualCsv;

  // Handle file selection (CSV or ZIP)
  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;

    const newBatchFiles: BatchFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.name.endsWith('.zip')) {
        // Extract CSV files from ZIP
        try {
          const zip = new JSZip();
          const zipContent = await zip.loadAsync(file);

          for (const [fileName, fileObj] of Object.entries(zipContent.files)) {
            if (fileName.endsWith('.csv') && !fileObj.dir) {
              const csvContent = await fileObj.async('string');
              newBatchFiles.push({
                id: `${Date.now()}-${Math.random()}`,
                name: fileName,
                content: csvContent,
                status: 'pending',
              });
            }
          }
        } catch (err: any) {
          setError(`Failed to extract ZIP file: ${err.message}`);
        }
      } else if (file.name.endsWith('.csv')) {
        // Read CSV file directly
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          newBatchFiles.push({
            id: `${Date.now()}-${Math.random()}`,
            name: file.name,
            content,
            status: 'pending',
          });
        };
        reader.readAsText(file);
      }
    }

    // Wait for all file reads to complete
    setTimeout(() => {
      setBatchFiles((prev) => [...prev, ...newBatchFiles]);
      setUploadMode('batch');
    }, 100);
  };

  const handleUpload = async () => {
    if (!courseUrl.trim() || !accessToken.trim()) {
      setError('Please enter Canvas URL and access token');
      return;
    }

    if (uploadMode === 'single' && !csvToUse.trim()) {
      setError('No CSV content to upload');
      return;
    }

    if (uploadMode === 'batch' && batchFiles.length === 0) {
      setError('No CSV files to upload');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadStatus(null);
    setDeploymentLogs([]);

    const base = courseUrl.startsWith('http')
      ? courseUrl.replace(/\/$/, '')
      : `https://${courseUrl.replace(/\/$/, '')}`;
    const courseHomeUrl = courseId.trim() ? `${base}/courses/${courseId.trim()}` : courseUrl;
    const config: CanvasConfig = {
      courseHomeUrl,
      accessToken,
    };

    const addLog = (message: string) => {
      const timestamp = new Date().toLocaleTimeString();
      setDeploymentLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    };

    try {
      if (uploadMode === 'single') {
        addLog('Starting single rubric upload...');
        // Single upload
        startProgress(1, true);
        setProgress({ currentStep: 'Uploading rubric to Canvas...' });

        try {
          const result = await pushRubricToCanvas(config, csvToUse);
          setUploadStatus(result);

          if (result.success) {
            addLog('✓ Upload successful!');
            setCanvasConfig(config);
            addToHistory({
              id: Date.now().toString(),
              timestamp: Date.now(),
              rubricName: 'Uploaded Rubric',
              totalPoints: parseInt(state.rubricMetadata?.totalPoints || '0') || 100,
              csvFileName: state.csvFileName || 'rubric.csv',
              canvasUploadStatus: 'success',
            });
            setProgress({ percentage: 1, itemsProcessed: 1 });

            setTimeout(() => {
              stopProgress();
            }, 500);
          } else {
            addLog(`✗ Upload failed: ${result.message}`);
            stopProgress();
          }
        } catch (err: any) {
          addLog(`✗ Error: ${err.message}`);
          stopProgress();
        }
      } else {
        // Batch upload with progress tracking
        addLog(`Starting batch upload (${batchFiles.length} files)...`);
        startProgress(batchFiles.length, true);

        const updatedFiles = [...batchFiles];
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < updatedFiles.length; i++) {
          // Check if cancelled
          const signal = getAbortSignal();
          if (signal.aborted) {
            addLog('Upload cancelled by user');
            setError('Upload cancelled by user');
            break;
          }

          // Wait 10 seconds between uploads (not before the first)
          if (i > 0) {
            addLog('Waiting 10 seconds before next upload…');
            try {
              await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, 10_000);
                signal.addEventListener('abort', () => {
                  clearTimeout(timer);
                  reject(new Error('Upload cancelled'));
                }, { once: true });
              });
            } catch {
              addLog('Upload cancelled during wait');
              setError('Upload cancelled by user');
              break;
            }
            // Re-check after the wait
            if (getAbortSignal().aborted) break;
          }

          const file = updatedFiles[i];
          updatedFiles[i] = { ...file, status: 'uploading' };
          setBatchFiles([...updatedFiles]);
          addLog(`Uploading: ${file.name}...`);

          // Update progress
          const percentage = i / updatedFiles.length;
          setProgress({
            currentStep: `Uploading: ${file.name}`,
            percentage,
            itemsProcessed: i,
          });

          try {
            const result = await pushRubricToCanvas(config, file.content);

            if (result.success) {
              updatedFiles[i] = {
                ...file,
                status: 'success',
                message: 'Successfully uploaded',
              };
              successCount++;
              addLog(`✓ ${file.name} uploaded successfully`);

              addToHistory({
                id: Date.now().toString(),
                timestamp: Date.now(),
                rubricName: file.name.replace('.csv', ''),
                totalPoints: 100,
                csvFileName: file.name,
                canvasUploadStatus: 'success',
              });
            } else {
              updatedFiles[i] = {
                ...file,
                status: 'error',
                message: result.message,
              };
              errorCount++;
              addLog(`✗ ${file.name} failed: ${result.message}`);
            }
          } catch (err: any) {
            updatedFiles[i] = {
              ...file,
              status: 'error',
              message: err.message,
            };
            errorCount++;
            addLog(`✗ ${file.name} error: ${err.message}`);
          }

          setBatchFiles([...updatedFiles]);
        }

        // Final progress update
        setProgress({ percentage: 1, itemsProcessed: batchFiles.length });

        const uploadSuccess = errorCount === 0;
        setUploadStatus({
          success: uploadSuccess,
          message: `Batch upload complete: ${successCount} successful, ${errorCount} failed`,
        });

        if (uploadSuccess) {
          setTimeout(() => {
            stopProgress();
          }, 500);
        } else {
          stopProgress();
        }
      }
    } catch (err: any) {
      stopProgress();
      setUploadStatus({
        success: false,
        message: `Upload failed: ${err.message}`,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeBatchFile = (id: string) => {
    setBatchFiles((prev) => prev.filter((f) => f.id !== id));
    setAnalysisMap((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (batchFiles.length === 1) {
      setUploadMode('single');
    }
  };

  const clearBatchFiles = () => {
    analyzeAbortRef.current?.abort();
    setBatchFiles([]);
    setAnalysisMap({});
    setIsAnalyzing(false);
    setUploadMode('single');
  };

  // Validate Canvas credentials by making a test GET request to the course endpoint
  const handleValidate = async () => {
    if (!courseUrl.trim() || !courseId.trim() || !accessToken.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const base = courseUrl.startsWith('http')
        ? courseUrl.replace(/\/$/, '')
        : `https://${courseUrl.replace(/\/$/, '')}`;
      const res = await fetch('/canvas-proxy/api/v1/courses/' + courseId.trim(), {
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'x-canvas-base': base,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setValidationResult({ ok: true, message: `✓ Connected — ${data.name || 'Course found'}` });
      } else if (res.status === 401) {
        setValidationResult({ ok: false, message: '✗ Invalid API token — check your credentials' });
      } else if (res.status === 404) {
        setValidationResult({ ok: false, message: '✗ Course not found — check the Course ID' });
      } else {
        setValidationResult({ ok: false, message: `✗ Error ${res.status}: ${res.statusText}` });
      }
    } catch (err: any) {
      setValidationResult({ ok: false, message: `✗ Network error: ${err.message}` });
    } finally {
      setValidating(false);
    }
  };

  // Analyse all queued CSV files with Gemini before uploading
  const handleAnalyzeFiles = async () => {
    if (batchFiles.length === 0 || isAnalyzing) return;

    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    setIsAnalyzing(true);

    // Mark every file as 'analyzing' immediately
    const initialMap: Record<string, CsvAnalysisResult | 'analyzing' | 'error'> = {};
    batchFiles.forEach((f) => { initialMap[f.id] = 'analyzing'; });
    setAnalysisMap(initialMap);

    // Process files one at a time — prevents concurrent retry storms that exhaust the quota.
    // Parallel dispatch was causing all N retry chains to run simultaneously, overwhelming
    // the API even with the throttle queue (retries bypass the queue after the initial slot).
    for (const file of batchFiles) {
      if (controller.signal.aborted) break;
      try {
        const result = await analyzeCsvForCanvas(file.content, controller.signal);
        setAnalysisMap((prev) => ({ ...prev, [file.id]: result }));
      } catch (err: any) {
        // Always clear 'analyzing' state — whether error or cancellation
        setAnalysisMap((prev) => ({ ...prev, [file.id]: 'error' }));
      }
    }

    setIsAnalyzing(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto w-full">
        {/* Phase 2 carry-forward banner */}
        {state.csvOutput && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">
            <p className="font-bold text-green-900 text-sm">CSV Rubric batch from Phase 2 is ready</p>
            <p className="text-xs text-green-800 mt-0.5">
              Review the file(s) and proceed when ready.
            </p>
          </div>
        )}

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-black text-gray-900 mb-2">Upload to Canvas</h2>
          <p className="text-gray-600 font-medium mb-6">
            {uploadMode === 'single'
              ? 'Enter your Canvas credentials to upload the rubric'
              : 'Upload multiple CSV files to Canvas LMS'}
          </p>

          {/* Informational Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm text-blue-900 font-medium">
              This app will upload one or more CSV rubric files to Canvas at a time, and Canvas will then transform each file into a separate rubric.
            </p>
          </div>
        </div>

        {/* Upload Mode Toggle */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={() => {
              setUploadMode('single');
              clearBatchFiles();
            }}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              uploadMode === 'single'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Single Upload
          </button>
          <button
            onClick={() => setUploadMode('batch')}
            className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
              uploadMode === 'batch'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Batch Upload
          </button>
        </div>

        {/* Two-Column Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Queue + Timeline */}
          <div className="lg:col-span-2 flex flex-col gap-6">

            {/* CSV Display (Single Mode) */}
            {uploadMode === 'single' && state.csvOutput && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                <p className="text-sm font-bold text-blue-900">
                  ✓ CSV file ready ({state.csvFileName || 'rubric.csv'})
                </p>
              </div>
            )}

            {uploadMode === 'single' && !state.csvOutput && !manualCsv && (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-2xl">
                <p className="text-sm font-bold text-yellow-900">
                  ⚠ No CSV available. You can paste CSV content below or go back to Part 2.
                </p>
              </div>
            )}

            {/* Batch File Upload / Queue */}
            {uploadMode === 'batch' && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-blue-600" />
                  Batch Rubric Queue
                </h3>
                <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center hover:border-blue-400 transition-all cursor-pointer relative">
                  <input
                    type="file"
                    multiple
                    accept=".csv,.zip"
                    onChange={(e) => handleFileSelect(e.target.files)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-gray-700">
                    Drag & drop CSV files or ZIP archive here
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Supports .csv files and .zip archives containing CSV files
                  </p>
                </div>

                {/* Batch Files List */}
                {batchFiles.length > 0 && (
                  <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                    {batchFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {file.status === 'success' && (
                            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                          )}
                          {file.status === 'error' && (
                            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                          )}
                          {file.status === 'pending' && analysisMap[file.id] !== 'analyzing' && (
                            <Upload className="w-5 h-5 text-gray-400 flex-shrink-0" />
                          )}
                          {(file.status === 'uploading' || analysisMap[file.id] === 'analyzing') && (
                            <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {file.name}
                            </p>
                            {file.message && (
                              <p className="text-xs text-gray-600 truncate">
                                {file.message}
                              </p>
                            )}
                          </div>
                        </div>
                        {file.status === 'pending' && (
                          <button
                            onClick={() => removeBatchFile(file.id)}
                            className="ml-2 text-gray-400 hover:text-red-600 flex-shrink-0"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {batchFiles.length > 0 && (
                  <button
                    onClick={clearBatchFiles}
                    className="mt-3 text-sm font-bold text-gray-600 hover:text-red-600"
                  >
                    Clear all files
                  </button>
                )}

                {/* AI Pre-Analysis section */}
                {batchFiles.length > 0 && (
                  <div className="mt-5 border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-black text-gray-400 uppercase tracking-wider">
                        AI Pre-Analysis
                      </span>
                      {!isAnalyzing && Object.keys(analysisMap).length === 0 && (
                        <span className="text-xs text-gray-400">
                          ~{batchFiles.length * 10}s estimated&nbsp;({batchFiles.length}&nbsp;file{batchFiles.length !== 1 ? 's' : ''}&nbsp;×&nbsp;~10s)
                        </span>
                      )}
                    </div>

                    <button
                      onClick={handleAnalyzeFiles}
                      disabled={isAnalyzing}
                      className="w-full px-4 py-2 bg-gray-100 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-gray-700 hover:text-blue-700 rounded-xl font-bold transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Analyzing… (~{batchFiles.length * 10}s total)
                        </>
                      ) : (
                        <>
                          <ScanSearch className="w-4 h-4" />
                          Analyze {batchFiles.length} File{batchFiles.length !== 1 ? 's' : ''} with AI
                        </>
                      )}
                    </button>

                    {/* Per-file analysis result cards */}
                    {Object.keys(analysisMap).length > 0 && (
                      <div className="mt-3 space-y-2">
                        {batchFiles.map((file) => {
                          const result = analysisMap[file.id];
                          if (!result) return null;

                          if (result === 'analyzing') return (
                            <div key={file.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-xl text-xs text-gray-500">
                              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                              <span className="truncate">{file.name}</span>
                            </div>
                          );

                          if (result === 'error') return (
                            <div key={file.id} className="flex items-center gap-2 p-2 bg-red-50 rounded-xl text-xs text-red-600">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{file.name} — analysis failed</span>
                            </div>
                          );

                          return (
                            <div key={file.id} className={`p-3 rounded-xl text-xs ${result.isValid ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                              <div className="flex items-center gap-2 mb-1">
                                {result.isValid
                                  ? <CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
                                  : <AlertCircle className="w-3 h-3 text-yellow-600 flex-shrink-0" />
                                }
                                <span className="font-bold text-gray-900 truncate">
                                  {result.rubricName || file.name}
                                </span>
                              </div>
                              <p className="text-gray-500 ml-5">
                                {result.criteriaCount} criteria · {result.totalPoints} pts
                              </p>
                              <p className="text-gray-400 ml-5 mt-0.5 italic">{result.notes}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Deployment Timeline / Logs */}
            <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 shadow-sm">
              <div className="flex justify-between items-center p-4 border-b border-gray-800">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Deployment Timeline</h3>
                <button
                  onClick={() => setDeploymentLogs([])}
                  className="text-xs text-gray-500 hover:text-gray-300 font-bold"
                >
                  Clear Console
                </button>
              </div>
              <div className="p-4 h-64 overflow-y-auto font-mono text-xs text-gray-400">
                {deploymentLogs.length === 0 ? (
                  <p className="text-gray-600">No activity yet. Upload CSVs to start deployment.</p>
                ) : (
                  deploymentLogs.map((log, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words mb-1">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Status Messages in Left Column */}
            {state.error && (
              <ErrorDisplay error={state.error} />
            )}

            {uploadStatus && (
              <div
                className={`p-4 border rounded-2xl ${
                  uploadStatus.success
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <p
                  className={`text-sm font-bold ${
                    uploadStatus.success ? 'text-green-900' : 'text-red-900'
                  }`}
                >
                  {uploadStatus.message}
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Config Panel */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            {/* Network Tunnel Section */}
            <div className="bg-blue-50 p-6 rounded-2xl border border-blue-200 shadow-sm">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-blue-900 mb-2">Network Tunnel</h3>
                  <p className="text-sm text-blue-800 mb-4">
                    Canvas requests are routed through the local dev server, so no browser extension is required.
                  </p>
                  <p className="text-xs text-green-700 font-semibold text-center">
                    ✓ Tunnel active — Canvas requests proxied via Vite dev server
                  </p>
                  <p className="text-xs text-blue-600 mt-1 text-center">
                    No setup required. CORS is handled server-side automatically.
                  </p>
                </div>
              </div>
            </div>

            {/* Target Course & User Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 uppercase text-sm tracking-wider">Target Course & User</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Canvas URL
                  </label>
                  <p className="text-xs text-gray-400 mb-2">
                    Paste your full course URL — Course ID will be filled automatically
                  </p>
                  <input
                    type="text"
                    value={courseUrl}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setValidationResult(null);
                      // Auto-extract base URL and course ID from a full Canvas course URL
                      // e.g. https://boisestate.instructure.com/courses/123456
                      const match = raw.match(/^(https?:\/\/[^/]+)(?:\/courses\/(\d+))?/i);
                      if (match) {
                        const baseUrl = match[1];
                        setCourseUrl(baseUrl);  // Store ONLY the base URL
                        if (match[2]) {
                          setCourseId(match[2]);  // Extract course ID if present in URL
                        }
                      } else {
                        setCourseUrl(raw);  // Fallback: store as-is if parsing fails
                      }
                    }}
                    placeholder="https://boisestate.instructure.com or paste full course URL"
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Course ID
                  </label>
                  <input
                    type="text"
                    value={courseId}
                    onChange={(e) => { setCourseId(e.target.value); setValidationResult(null); }}
                    placeholder="Auto-filled from URL, or enter manually"
                    className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Canvas API Token
                  </label>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="Type your token here"
                      className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                    >
                      {showToken ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleValidate}
                  disabled={validating || !courseUrl.trim() || !courseId.trim() || !accessToken.trim()}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all text-sm disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                >
                  {validating ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
                  ) : (
                    'Validate Connection'
                  )}
                </button>
                {!validationResult && (!courseUrl.trim() || !courseId.trim() || !accessToken.trim()) && (
                  <p className="text-xs text-gray-400 text-center">
                    {!courseUrl.trim() ? 'Enter Canvas URL' : !courseId.trim() ? 'Enter Course ID' : 'Enter API Token'} to enable validation
                  </p>
                )}
                {validationResult && (
                  <p className={`text-xs font-semibold mt-1 text-center ${validationResult.ok ? 'text-green-700' : 'text-red-600'}`}>
                    {validationResult.message}
                  </p>
                )}
              </div>
            </div>

            {/* Manual CSV Input (Single Mode) */}
            {uploadMode === 'single' && !state.csvOutput && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <button
                  onClick={() => setShowManualInput(!showManualInput)}
                  className="text-sm font-bold text-blue-600 hover:underline"
                >
                  {showManualInput ? '▼ Hide CSV Input' : '▶ Paste CSV Manually'}
                </button>
                {showManualInput && (
                  <textarea
                    value={manualCsv}
                    onChange={(e) => setManualCsv(e.target.value)}
                    placeholder="Paste your CSV content here..."
                    className="w-full h-32 p-3 border rounded-xl mt-3 focus:ring-2 focus:ring-blue-500 outline-none text-xs font-mono"
                  />
                )}
              </div>
            )}

            {/* BUILD IN CANVAS Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 uppercase text-sm tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-600" />
                Build in Canvas
              </h3>

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={
                  isUploading ||
                  !courseUrl.trim() ||
                  !accessToken.trim() ||
                  (uploadMode === 'single' && !csvToUse.trim()) ||
                  (uploadMode === 'batch' && batchFiles.length === 0)
                }
                className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
              >
                {isUploading && <Loader2 className="w-5 h-5 animate-spin" />}
                {isUploading
                  ? uploadMode === 'batch'
                    ? 'Uploading Batch...'
                    : 'Uploading...'
                  : uploadMode === 'batch'
                  ? `Deploy ${batchFiles.length} File(s)`
                  : 'Deploy Rubric to Canvas'}
              </button>

              {/* Time estimate */}
              {!isUploading && uploadMode === 'batch' && batchFiles.length > 0 && (
                <p className="text-xs text-gray-500 text-center mt-2">
                  {batchFiles.length === 1
                    ? 'Estimated time: ~2s'
                    : `Estimated time: ~${batchFiles.length * 2 + (batchFiles.length - 1) * 10}s (${batchFiles.length} uploads + ${batchFiles.length - 1}×10s gaps)`}
                </p>
              )}
              {!isUploading && uploadMode === 'single' && csvToUse.trim() && (
                <p className="text-xs text-gray-500 text-center mt-2">
                  Estimated time: ~2 seconds
                </p>
              )}

              {/* Additional Actions */}
              <div className="grid grid-cols-2 gap-3 mt-4">
                <button
                  onClick={() => {
                    setCourseUrl('');
                    setAccessToken('');
                    setManualCsv('');
                    setUploadStatus(null);
                    clearBatchFiles();
                  }}
                  className="px-4 py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all text-sm border border-gray-200"
                >
                  Clear All
                </button>
                <button
                  onClick={() => window.open('https://canvas.instructure.com/doc/api/file.accessing_via_api.html', '_blank')}
                  className="px-4 py-2 text-blue-600 rounded-xl font-bold hover:bg-blue-50 transition-all text-sm border border-blue-200"
                >
                  Canvas Docs
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
