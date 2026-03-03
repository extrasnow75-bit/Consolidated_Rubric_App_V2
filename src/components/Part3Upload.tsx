import React, { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, CanvasConfig } from '../types';
import { pushRubricToCanvas } from '../services/canvasService';
import { Eye, EyeOff, Loader2, Upload, CheckCircle, AlertCircle, X, Zap, FolderOpen } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import JSZip from 'jszip';
import { googleDriveService } from '../services/googleDriveService';

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
  const [accessToken, setAccessToken] = useState(state.canvasApiToken || '');
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [manualCsv, setManualCsv] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [uploadMode, setUploadMode] = useState<'single' | 'batch' | 'google-drive'>('single');
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);
  const [pickingFromDrive, setPickingFromDrive] = useState(false);
  const [drivePickedCsv, setDrivePickedCsv] = useState<string | null>(null);
  const [drivePickedFileName, setDrivePickedFileName] = useState('');

  const csvToUse = state.csvOutput || drivePickedCsv || manualCsv;

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDeploymentLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // Helper: extract course ID from full Canvas course URL
  const extractCourseId = (url: string): string => {
    const match = url.match(/\/courses\/(\d+)/i);
    return match ? match[1] : '';
  };

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

    if ((uploadMode === 'single' || uploadMode === 'google-drive') && !csvToUse.trim()) {
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

    const courseHomeUrl = courseUrl.startsWith('http')
      ? courseUrl.replace(/\/$/, '')
      : `https://${courseUrl.replace(/\/$/, '')}`;
    const config: CanvasConfig = {
      courseHomeUrl,
      accessToken,
    };

    try {
      if (uploadMode === 'single' || uploadMode === 'google-drive') {
        addLog('Starting single rubric upload...');
        // Single upload
        startProgress(1, true);
        setProgress({ currentStep: 'Uploading rubric to Canvas...' });

        try {
          const result = await pushRubricToCanvas(config, csvToUse);

          if (result.success) {
            addLog('✓ Upload successful!');
            setUploadStatus(result);
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
            // Full error detail goes to the log; status box shows a short summary
            addLog(`✗ Upload failed: ${result.message}`);
            setUploadStatus({ success: false, message: 'Upload failed — see the deployment log above for details.' });
            stopProgress();
          }
        } catch (err: any) {
          addLog(`✗ Error: ${err.message}`);
          setUploadStatus({ success: false, message: 'Upload failed — see the deployment log above for details.' });
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
    if (batchFiles.length === 1) {
      setUploadMode('single');
    }
  };

  const clearBatchFiles = () => {
    setBatchFiles([]);
    setUploadMode('single');
  };

  /** Open the Google Drive file picker filtered to Sheets, fetch the chosen sheet as CSV. */
  const handleGoogleDrivePick = async () => {
    if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
      setError('Please sign in with Google on the Dashboard first.');
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
        const csvData = await googleDriveService.getGoogleSheetContent(
          result.fileId,
          state.googleAccessToken,
        );
        setDrivePickedCsv(csvData);
        setDrivePickedFileName(`${result.name}.csv`);
        setCsvOutput(csvData, `${result.name}.csv`);
      }
    } catch (err: any) {
      setError(`Google Drive: ${err.message}`);
    } finally {
      setPickingFromDrive(false);
    }
  };

  // Validate Canvas credentials by making a test GET request to the course endpoint
  const handleValidate = async () => {
    const courseId = extractCourseId(courseUrl);
    if (!courseUrl.trim() || !courseId || !accessToken.trim()) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const base = courseUrl.startsWith('http')
        ? courseUrl.replace(/\/courses\/\d+.*$/, '').replace(/\/$/, '')
        : `https://${courseUrl.replace(/\/courses\/\d+.*$/, '').replace(/\/$/, '')}`;
      addLog(`Checking: ${base}/api/v1/courses/${courseId}`);
      const res = await fetch('/canvas-proxy/api/v1/courses/' + courseId, {
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'x-canvas-base': base,
          'Content-Type': 'application/json',
        },
      });

      // Read the body for all responses so we can show the actual Canvas / proxy error
      const rawText = await res.text().catch(() => '');
      let errorDetail = '';
      if (!res.ok) {
        try {
          const json = JSON.parse(rawText);
          // Canvas wraps errors as { errors: [{ type, message }] } or { message }
          errorDetail =
            json.errors?.[0]?.message ||
            json.errors?.[0]?.type ||
            json.message ||
            json.error ||
            '';
        } catch {
          // Not JSON — could be an HTML Vercel error page or plain text
          errorDetail = rawText.replace(/<[^>]+>/g, '').trim().slice(0, 200);
        }
      }

      if (res.ok) {
        let data: any = {};
        try { data = JSON.parse(rawText); } catch { /* ignore */ }
        const msg = `✓ Connected — ${data.name || 'Course found'}`;
        setValidationResult({ ok: true, message: msg });
        addLog(msg);
      } else if (res.status === 401) {
        const detail = errorDetail ? ` (${errorDetail})` : '';
        const msg = `✗ Unauthorized (401)${detail} — token may be invalid or expired`;
        setValidationResult({ ok: false, message: msg });
        addLog(msg);
      } else if (res.status === 404) {
        const detail = errorDetail ? ` — ${errorDetail}` : '';
        addLog(`✗ Not found (404)${detail}`);
        if (!errorDetail || errorDetail.toLowerCase().includes('not') || errorDetail.toLowerCase().includes('course')) {
          // Looks like a genuine Canvas 404
          const msg = '✗ Course not found (404) — verify the Course URL and that your token has access to this course';
          setValidationResult({ ok: false, message: msg });
        } else {
          // Unexpected body — likely a Vercel routing error, not Canvas
          const msg = `✗ Proxy error (404): ${errorDetail || 'unexpected response — check Vercel function logs'}`;
          setValidationResult({ ok: false, message: msg });
          addLog('  Hint: This may be a proxy routing issue, not a Canvas error.');
        }
      } else {
        const detail = errorDetail ? `: ${errorDetail}` : `: ${res.statusText}`;
        const msg = `✗ Error ${res.status}${detail}`;
        setValidationResult({ ok: false, message: msg });
        addLog(msg);
      }
    } catch (err: any) {
      const msg = `✗ Network error: ${err.message}`;
      setValidationResult({ ok: false, message: msg });
      addLog(msg);
    } finally {
      setValidating(false);
    }
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
              : uploadMode === 'google-drive'
              ? 'Pick a CSV from Google Drive and upload to Canvas'
              : 'Upload multiple CSV files to Canvas LMS'}
          </p>

          {/* Informational Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
            <p className="text-sm text-blue-900 font-medium">
              This app will upload one or more CSV rubric files to Canvas at a time, and Canvas will then transform each file into a separate rubric.
            </p>
          </div>
        </div>

        {/* Upload Mode Tabs */}
        <div className="mb-6 border-b border-gray-200 flex gap-0">
          <button
            onClick={() => {
              setUploadMode('single');
              clearBatchFiles();
            }}
            className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
              uploadMode === 'single'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            From Phase 2
          </button>
          <button
            onClick={() => setUploadMode('google-drive')}
            className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
              uploadMode === 'google-drive'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Google Drive
          </button>
          <button
            onClick={() => setUploadMode('batch')}
            className={`px-4 py-3 font-bold text-sm transition-all border-b-2 -mb-px ${
              uploadMode === 'batch'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
            {uploadMode === 'single' && csvToUse && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl">
                <p className="text-sm font-bold text-blue-900">
                  ✓ CSV file ready ({state.csvFileName || drivePickedFileName || 'rubric.csv'})
                </p>
              </div>
            )}

            {uploadMode === 'single' && !csvToUse && (
              <div className="p-5 bg-yellow-50 border border-yellow-200 rounded-2xl space-y-2">
                <p className="text-sm font-bold text-yellow-900">
                  ⚠ No CSV available from Phase 2.
                </p>
                <p className="text-xs text-yellow-700">
                  Go back to Phase 2 to generate a CSV, use the Google Drive tab, or paste CSV content in the manual input below.
                </p>
              </div>
            )}

            {/* Google Drive Tab Content */}
            {uploadMode === 'google-drive' && (
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-blue-600" />
                  Pick CSV from Google Drive
                </h3>
                {drivePickedCsv ? (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-sm font-bold text-blue-900">✓ CSV ready: {drivePickedFileName}</p>
                    <button
                      onClick={() => { setDrivePickedCsv(null); setDrivePickedFileName(''); }}
                      className="text-xs text-blue-600 hover:underline mt-1"
                    >
                      Pick a different file
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleGoogleDrivePick}
                      disabled={pickingFromDrive || !state.isGoogleAuthenticated}
                      className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-all flex items-center justify-center gap-2"
                    >
                      {pickingFromDrive ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      {pickingFromDrive ? 'Opening Drive…' : 'Open Google Drive Picker'}
                    </button>
                    {!state.isGoogleAuthenticated && (
                      <p className="text-xs text-red-600 font-bold text-center">
                        Sign in with Google on the Dashboard to use this option.
                      </p>
                    )}
                  </>
                )}
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
                          {file.status === 'pending' && (
                            <Upload className="w-5 h-5 text-gray-400 flex-shrink-0" />
                          )}
                          {file.status === 'uploading' && (
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

              </div>
            )}

            {/* Deployment Timeline / Logs */}
            <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 shadow-sm">
              <div className="flex justify-between items-center p-4 border-b border-gray-800">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Deployment Timeline</h3>
                <div className="flex gap-3">
                  <button
                    onClick={() => navigator.clipboard.writeText(deploymentLogs.join('\n'))}
                    disabled={deploymentLogs.length === 0}
                    className="text-xs text-gray-500 hover:text-gray-300 font-bold disabled:opacity-40"
                  >
                    Copy Logs
                  </button>
                  <button
                    onClick={() => setDeploymentLogs([])}
                    className="text-xs text-gray-500 hover:text-gray-300 font-bold"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="p-4 h-64 overflow-y-auto font-mono text-xs">
                {deploymentLogs.length === 0 ? (
                  <p className="text-gray-600">No activity yet. Upload CSVs to start deployment.</p>
                ) : (
                  deploymentLogs.map((log, i) => {
                    const isSuccess = log.includes('✓');
                    const isError = log.includes('✗');
                    return (
                      <div
                        key={i}
                        className={`whitespace-pre-wrap break-words mb-1 ${
                          isSuccess ? 'text-green-400' : isError ? 'text-red-400' : 'text-gray-400'
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })
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
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    uploadStatus.success ? 'text-green-900' : 'text-amber-800'
                  }`}
                >
                  {uploadStatus.message}
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Config Panel */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            {/* Target Course & User Section */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 uppercase text-sm tracking-wider">Target Course & User</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Canvas Course URL
                  </label>
                  <p className="text-xs text-gray-900 mb-2">
                    Paste the URL of your Canvas course home page.
                  </p>
                  <input
                    type="text"
                    value={courseUrl}
                    onChange={(e) => {
                      setValidationResult(null);
                      setCourseUrl(e.target.value);
                    }}
                    placeholder="https://boisestate.instructure.com/courses/12345"
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
                  disabled={validating || !courseUrl.trim() || !accessToken.trim()}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all text-sm disabled:opacity-50 disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                >
                  {validating ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Checking…</>
                  ) : (
                    'Validate Connection'
                  )}
                </button>
                {!validationResult && (!courseUrl.trim() || !accessToken.trim()) && (
                  <p className="text-xs text-gray-400 text-center">
                    {!courseUrl.trim() ? 'Enter Canvas URL (with course ID)' : 'Enter API Token'} to enable validation
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
                  ((uploadMode === 'single' || uploadMode === 'google-drive') && !csvToUse.trim()) ||
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
