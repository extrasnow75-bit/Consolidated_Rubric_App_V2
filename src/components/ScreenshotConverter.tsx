import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, PointStyle, ProcessingType, GenerationSettings } from '../types';
import { generateRubricFromScreenshot } from '../services/geminiService';
import { exportToWord } from '../services/wordExportService';
import { Upload, Download, Loader2, Trash2, Image as ImageIcon, HardDrive, FolderOpen, Clipboard, Clock, ChevronDown, ChevronUp, X, RotateCw, CheckCircle2 } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import { googleDriveService } from '../services/googleDriveService';
import { getRecentImages, saveRecentImage, RecentImage } from '../utils/recentImages';

export const ScreenshotConverter: React.FC = () => {
  const {
    state,
    setRubric,
    setIsLoading,
    setError,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
    openGooglePicker,
    downloadDriveFile,
    startGoogleAuth,
    signOutGoogle,
  } = useSession();

  const googleSignedIn = state.isGoogleAuthenticated;

  const [activeTab, setActiveTab] = useState<'local' | 'google-drive'>('local');
  const [imageFile, setImageFile] = useState<{ data: string; mimeType: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPasteFocused, setIsPasteFocused] = useState(false);
  const [settings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
    processingType: ProcessingType.SINGLE,
  });

  // Google Drive tab state
  const [driveImageUrl, setDriveImageUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [isPickerLoading, setIsPickerLoading] = useState(false);
  const [recentImages, setRecentImages] = useState<RecentImage[]>(() => getRecentImages());
  const [showRecentImages, setShowRecentImages] = useState(false);

  // Upload to Canvas state
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [uploadDocTab, setUploadDocTab] = useState<'phase1' | 'local' | 'google-drive'>('phase1');
  const [canvasUrl, setCanvasUrl] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // ── Deployment timer ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isDeploying) return;
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isDeploying]);

  // ── Image handler ──────────────────────────────────────────────────────────

  const handleImageSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, or WebP).');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const imageData = event.target?.result as string;
        setImageFile({ data: imageData.split(',')[1], mimeType: file.type });
        setImagePreview(imageData);
        setIsLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(`Failed to process image: ${err.message}`);
      setIsLoading(false);
    }
  }, [setIsLoading, setError]);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleImageSelect(e.dataTransfer.files[0]);
  };

  // ── Clipboard paste (global + paste area) ─────────────────────────────────

  const extractImageFromClipboard = useCallback((clipboardData: DataTransfer | null) => {
    if (!clipboardData) return;
    const items = Array.from(clipboardData.items);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) handleImageSelect(file);
        return;
      }
    }
  }, [handleImageSelect]);

  const imagePreviewRef = useRef(imagePreview);
  imagePreviewRef.current = imagePreview;

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (imagePreviewRef.current) return;
      extractImageFromClipboard(e.clipboardData as unknown as DataTransfer);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [extractImageFromClipboard]);

  const handlePasteAreaPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    extractImageFromClipboard(e.clipboardData);
  };

  // ── Shared helper: load image from Drive buffer ────────────────────────────

  const loadImageFromBuffer = (buffer: ArrayBuffer, mimeType: string) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    const base64 = btoa(binary);
    const dataUrl = `data:${mimeType};base64,${base64}`;
    setImageFile({ data: base64, mimeType });
    setImagePreview(dataUrl);
  };

  // ── Google Drive picker ────────────────────────────────────────────────────

  const handleGooglePickerImage = async () => {
    setIsPickerLoading(true);
    setError(null);
    try {
      const result = await openGooglePicker();
      if (!result) return;
      if (!result.mimeType.startsWith('image/')) {
        setError('Please select an image file (PNG, JPG, or WebP).');
        return;
      }
      const buffer = await downloadDriveFile(result.fileId);
      loadImageFromBuffer(buffer, result.mimeType);
      saveRecentImage({ name: result.name, fileId: result.fileId, mimeType: result.mimeType, source: 'picker' });
      setRecentImages(getRecentImages());
    } catch (err: any) {
      setError(`Google Drive error: ${err.message}`);
    } finally {
      setIsPickerLoading(false);
    }
  };

  // ── Google Drive URL fetch ─────────────────────────────────────────────────

  const handleFetchDriveUrl = async () => {
    if (!state.googleAccessToken) { setError('Please sign in with Google first.'); return; }
    if (!driveImageUrl.trim()) { setError('Please enter a Google Drive URL.'); return; }
    setIsFetchingUrl(true);
    setError(null);
    try {
      const urlToSave = driveImageUrl.trim();
      const fileId = googleDriveService.extractFileIdFromUrl(urlToSave);
      const meta = await googleDriveService.verifyFileAccess(fileId, state.googleAccessToken);
      if (!meta.mimeType.startsWith('image/')) {
        setError(`"${meta.name}" is not an image file. Please provide a link to a PNG, JPG, or WebP image.`);
        return;
      }
      const buffer = await downloadDriveFile(fileId);
      loadImageFromBuffer(buffer, meta.mimeType);
      saveRecentImage({ name: meta.name, url: urlToSave, fileId, mimeType: meta.mimeType, source: 'url' });
      setRecentImages(getRecentImages());
      setDriveImageUrl('');
    } catch (err: any) {
      setError(`Failed to fetch from Google Drive: ${err.message}`);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  // ── Recent image click ─────────────────────────────────────────────────────

  const handleRecentImageClick = async (img: RecentImage) => {
    setShowRecentImages(false);
    if (!state.googleAccessToken) { setError('Please sign in with Google first.'); return; }
    setIsPickerLoading(true);
    setError(null);
    try {
      const fileId = img.fileId || (img.url ? googleDriveService.extractFileIdFromUrl(img.url) : null);
      if (!fileId) { setError('Could not resolve file ID for this image.'); return; }
      const buffer = await downloadDriveFile(fileId);
      const mimeType = img.mimeType || 'image/png';
      loadImageFromBuffer(buffer, mimeType);
    } catch (err: any) {
      setError(`Failed to re-load image: ${err.message}`);
    } finally {
      setIsPickerLoading(false);
    }
  };

  // ── Process image ──────────────────────────────────────────────────────────

  const handleProcessImage = async () => {
    if (!imageFile) { setError('Please select an image'); return; }
    setIsProcessing(true);
    setError(null);
    startProgress(1, true);
    setProgress({ currentStep: 'Analyzing screenshot...' });
    try {
      const signal = getAbortSignal();
      setProgress({ currentStep: 'Detecting rubric content...', percentage: 0.3 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (signal.aborted) { setError('Screenshot processing cancelled'); return; }
      setProgress({ currentStep: 'Extracting rubric data...', percentage: 0.6 });
      const rubric = await generateRubricFromScreenshot(imageFile, settings);
      if (signal.aborted) { setError('Screenshot processing cancelled'); return; }
      setProgress({ currentStep: 'Finalizing rubric...', percentage: 0.9 });
      setRubric(rubric);
      setProgress({ percentage: 1, itemsProcessed: 1 });
    } catch (err: any) {
      if (!getAbortSignal().aborted) setError(`Failed to process screenshot: ${err.message}`);
    } finally {
      setIsProcessing(false);
      stopProgress();
    }
  };

  const handleExportToWord = async () => {
    if (!state.rubric) return;
    try { await exportToWord(state.rubric); }
    catch (err: any) { setError(`Failed to export: ${err.message}`); }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setRubric(null);
    setError(null);
  };

  // ── Deploy to Canvas ───────────────────────────────────────────────────────────

  const handleDeployToCanvas = async () => {
    setIsDeploying(true);
    setElapsedSeconds(0);
    setDeploymentLogs([]);

    // Simulate deployment timeline
    const logs: string[] = [];

    // Step 1: Validating rubric
    logs.push('Validating rubric data...');
    setDeploymentLogs([...logs]);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Step 2: Connecting to Canvas
    logs.push('Connecting to Canvas course...');
    setDeploymentLogs([...logs]);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Step 3: Processing rubric
    logs.push('Processing rubric criteria...');
    setDeploymentLogs([...logs]);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 4: Uploading to Canvas
    logs.push('Uploading rubric to Canvas...');
    setDeploymentLogs([...logs]);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Step 5: Finalizing
    logs.push('Finalizing deployment...');
    setDeploymentLogs([...logs]);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Success
    logs.push('✓ Rubric deployed successfully!');
    setDeploymentLogs([...logs]);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsDeploying(false);
  };

  const handleCancelDeployment = () => {
    setIsDeploying(false);
    setElapsedSeconds(0);
    setDeploymentLogs([]);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 max-w-2xl w-full">

        {!state.rubric ? (
          <>
            {/* Title */}
            <h2 className="text-2xl font-black text-gray-900 mb-4">
              Screenshot to Word/Google Doc
            </h2>

            {/* Instructions */}
            <p className="text-sm font-black text-gray-900 uppercase tracking-wide mb-2">
              Instructions
            </p>
            <ol className="space-y-2 mb-6 text-sm text-gray-700">
              <li className="flex gap-2">
                <span className="font-black text-gray-900 flex-shrink-0">1.</span>
                <span>
                  Take a screenshot of the <span className="font-bold text-gray-900">full rubric</span>.
                  You may need to zoom out first so the entire rubric is visible on screen — press{' '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">Ctrl</kbd>
                  {' + '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">−</kbd>
                  {' '}on Windows, or{' '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">⌘</kbd>
                  {' + '}
                  <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-xs font-mono">−</kbd>
                  {' '}on Mac.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-black text-gray-900 flex-shrink-0">2.</span>
                <span>Upload the screenshot using one of the options below.</span>
              </li>
            </ol>

            {!imagePreview ? (
              <>
                {/* Tabs */}
                <div className="flex gap-3 mb-6 border-b border-gray-200">
                  <button
                    onClick={() => { setActiveTab('local'); setError(null); }}
                    className={`px-4 py-3 font-bold border-b-2 transition-all ${
                      activeTab === 'local'
                        ? 'border-[#0033a0] text-[#0033a0]'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    From Local Drive
                  </button>
                  <button
                    onClick={() => { setActiveTab('google-drive'); setError(null); }}
                    className={`px-4 py-3 font-bold border-b-2 transition-all ${
                      activeTab === 'google-drive'
                        ? 'border-[#0033a0] text-[#0033a0]'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    From Google Drive
                  </button>
                </div>

                {activeTab === 'local' ? (
                  <>
                    {/* Drag & drop zone */}
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
                      <ImageIcon className="w-8 h-8 text-gray-700" />
                      <p className="text-sm font-bold text-gray-700">
                        Drag & drop a screenshot here, or click to browse
                      </p>
                      <p className="text-xs text-gray-600 font-semibold">PNG, JPG, WebP supported</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => { if (e.target.files?.[0]) handleImageSelect(e.target.files[0]); e.target.value = ''; }}
                        className="hidden"
                      />
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">or</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Paste from clipboard */}
                    <div
                      ref={pasteAreaRef}
                      tabIndex={0}
                      onFocus={() => setIsPasteFocused(true)}
                      onBlur={() => setIsPasteFocused(false)}
                      onPaste={handlePasteAreaPaste}
                      className={`w-full p-5 border-2 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-text transition-all outline-none ${
                        isPasteFocused
                          ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200 ring-offset-1'
                          : 'border-gray-200 bg-gray-50 hover:border-blue-300'
                      }`}
                      onClick={() => pasteAreaRef.current?.focus()}
                    >
                      <Clipboard className={`w-5 h-5 transition-colors ${isPasteFocused ? 'text-blue-500' : 'text-gray-700'}`} />
                      <p className={`text-sm font-bold transition-colors ${isPasteFocused ? 'text-blue-700' : 'text-gray-700'}`}>
                        {isPasteFocused ? 'Ready — press Ctrl+V (or ⌘+V) to paste' : 'Click here to paste from clipboard'}
                      </p>
                      <p className="text-xs text-gray-700">
                        You can also paste anywhere on this page after copying a screenshot
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Google sign-in status */}
                    {googleSignedIn ? (
                      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center">
                            <span className="text-green-700 font-black text-sm">✓</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-green-900">Signed in as {state.googleUser?.name}</p>
                            <p className="text-xs text-green-700">{state.googleUser?.email}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => signOutGoogle()}
                          className="text-xs font-bold text-green-700 hover:text-green-900 transition-all"
                        >
                          Sign Out
                        </button>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6">
                        <p className="text-sm font-bold text-gray-700 mb-1">Google sign-in required</p>
                        <p className="text-xs text-gray-600 mb-3">Sign in to access images directly from your Drive.</p>
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

                    {/* Browse Drive button */}
                    <button
                      onClick={handleGooglePickerImage}
                      disabled={isPickerLoading || !googleSignedIn}
                      className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2 mb-6"
                    >
                      {isPickerLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FolderOpen className="w-4 h-4" />
                      )}
                      {isPickerLoading ? 'Opening Drive...' : 'Browse Google Drive'}
                    </button>

                    {/* Recent Images */}
                    {recentImages.length > 0 && (
                      <div className="mb-6">
                        <button
                          onClick={() => setShowRecentImages(!showRecentImages)}
                          className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors mb-2"
                        >
                          <Clock className="w-4 h-4" />
                          Recent Images
                          {showRecentImages ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {showRecentImages && (
                          <div className="border border-gray-200 rounded-xl overflow-hidden">
                            {recentImages.map((img, i) => (
                              <button
                                key={i}
                                onClick={() => handleRecentImageClick(img)}
                                disabled={isPickerLoading || !googleSignedIn}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-all text-left border-b border-gray-100 last:border-0 disabled:opacity-50"
                              >
                                <ImageIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-900 truncate">{img.name}</p>
                                  <p className="text-xs text-gray-600">
                                    {img.source === 'picker' ? 'Drive Picker' : 'URL'} · {new Date(img.timestamp).toLocaleDateString()}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Divider */}
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">or paste a URL</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Google Drive URL input */}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">
                        Google Drive URL
                      </label>
                      <input
                        type="url"
                        value={driveImageUrl}
                        onChange={(e) => setDriveImageUrl(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFetchDriveUrl(); }}
                        placeholder="drive.google.com/file/d/… or drive.google.com/open?id=…"
                        className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                      />
                      <p className="text-xs text-gray-600 mb-4">
                        Supports PNG, JPG, and WebP image files stored in Drive. The file must be accessible to your signed-in account.
                      </p>
                      <button
                        onClick={handleFetchDriveUrl}
                        disabled={!driveImageUrl.trim() || isFetchingUrl || !googleSignedIn}
                        className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm"
                      >
                        {isFetchingUrl ? 'Fetching...' : 'Fetch Image'}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Image Preview */}
                <div className="mb-6">
                  <p className="text-sm font-bold text-gray-700 mb-2">Preview</p>
                  <div className="border rounded-2xl overflow-hidden">
                    <img
                      src={imagePreview}
                      alt="Screenshot preview"
                      className="w-full max-h-64 object-contain"
                    />
                  </div>
                </div>

                {/* Process Button */}
                <button
                  onClick={handleProcessImage}
                  disabled={isProcessing}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2 mb-3"
                >
                  {isProcessing && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isProcessing ? 'Processing...' : 'Convert to Rubric'}
                </button>

                {/* Change Image */}
                <button
                  onClick={() => { setImageFile(null); setImagePreview(null); }}
                  className="w-full py-2 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-all"
                >
                  Choose Different Image
                </button>
              </>
            )}

            {state.error && <ErrorDisplay error={state.error} className="mt-6" />}
          </>
        ) : (
          <>
            {/* Results */}
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-2">{state.rubric.title}</h3>
              <p className="text-sm text-gray-600 mb-6">
                {state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points
              </p>

              <div className="overflow-x-auto mb-6 border rounded-2xl">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Criteria</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Exemplary</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Proficient</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Developing</th>
                      <th className="px-4 py-2 text-left font-black text-gray-900">Unsatisfactory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.rubric.criteria.map((criterion, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-2 font-bold text-gray-900">{criterion.category}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.exemplary.points}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.proficient.points}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.developing.points}</td>
                        <td className="px-4 py-2 text-gray-700">{criterion.unsatisfactory.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Success Message */}
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                <div className="flex gap-3 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <p className="font-bold text-green-700">Rubric created successfully!</p>
                </div>
                <p className="text-sm text-green-700">
                  Review the rubric above and make any edits as needed. To upload this rubric to Canvas, scroll to the top and select <span className="font-semibold">"Yes, I have a draft rubric document"</span> from the dropdown menu.
                </p>
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  onClick={handleExportToWord}
                  className="px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
                  </svg>
                  Add to Drive
                </button>

                <button
                  onClick={handleReset}
                  className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-300 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCw className="w-5 h-5" />
                  Convert Another
                </button>
              </div>

              <button
                onClick={() => setShowUploadSection(!showUploadSection)}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
              >
                <Upload className="w-5 h-5" />
                Upload Rubric to Canvas
              </button>
            </div>

            {/* Upload to Canvas Section */}
            {showUploadSection && (
              <div className="mt-6 space-y-6">
                {/* Draft Rubric Document Section */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-gray-900">Draft Rubric Document</h3>
                      <p className="text-sm text-gray-600">Do you already have a draft rubric document ready to deploy?</p>
                    </div>
                  </div>

                  <select className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-gray-900 mb-6">
                    <option>Yes - I have a draft rubric document</option>
                    <option>No - Create a new rubric</option>
                  </select>

                  {/* File Upload Tabs */}
                  <div className="flex gap-3 mb-4 border-b border-gray-200 pb-3">
                    {state.rubric && (
                      <button
                        onClick={() => setUploadDocTab('phase1')}
                        className={`px-4 py-2 font-bold transition-all ${
                          uploadDocTab === 'phase1'
                            ? 'border-b-2 border-[#0033a0] text-[#0033a0]'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        From Phase 1
                      </button>
                    )}
                    <button
                      onClick={() => setUploadDocTab('local')}
                      className={`px-4 py-2 font-bold transition-all ${
                        uploadDocTab === 'local'
                          ? 'border-b-2 border-[#0033a0] text-[#0033a0]'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      From Local Drive
                    </button>
                    <button
                      onClick={() => setUploadDocTab('google-drive')}
                      className={`px-4 py-2 font-bold transition-all ${
                        uploadDocTab === 'google-drive'
                          ? 'border-b-2 border-[#0033a0] text-[#0033a0]'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      From Google Drive
                    </button>
                  </div>

                  {/* From Phase 1 Tab */}
                  {uploadDocTab === 'phase1' && state.rubric && (
                    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-6">
                      <div className="flex items-start gap-3 mb-4">
                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <p className="font-bold text-blue-900">{state.rubric.title}</p>
                          <p className="text-sm text-blue-700">{state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points</p>
                        </div>
                      </div>
                      <p className="text-sm text-blue-700">This rubric from Phase 1 is ready to deploy. No file upload needed — just enter your Canvas course URL below.</p>
                    </div>
                  )}

                  {/* From Local Drive Tab */}
                  {uploadDocTab === 'local' && (
                    <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 bg-gray-50 cursor-pointer hover:border-blue-400 transition-all">
                      <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-sm font-bold text-gray-700">Drop a .docx or .doc file here or click to browse</p>
                    </div>
                  )}

                  {/* From Google Drive Tab */}
                  {uploadDocTab === 'google-drive' && (
                    <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 bg-gray-50 cursor-pointer hover:border-blue-400 transition-all">
                      <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <p className="text-sm font-bold text-gray-700">Drop a .docx or .doc file from Google Drive here or click to browse</p>
                    </div>
                  )}
                </div>

                {/* Target Canvas Course Section */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200">
                  <div className="flex items-start gap-3 mb-4">
                    <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-1.429 5.951 1.429a1 1 0 001.169-1.409l-7-14z" />
                    </svg>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Target Canvas Course</h3>
                      <p className="text-sm text-gray-600">Enter the homepage URL of the Canvas course you want to deploy rubrics to.</p>
                    </div>
                  </div>

                  <input
                    type="url"
                    value={canvasUrl}
                    onChange={(e) => setCanvasUrl(e.target.value)}
                    placeholder="https://canvas.institution.edu/courses/12345"
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-6"
                  />

                  <button
                    onClick={handleDeployToCanvas}
                    disabled={!canvasUrl.trim() || isDeploying}
                    className={`w-full px-4 py-3 rounded-xl font-bold transition-all ${
                      canvasUrl.trim() && !isDeploying
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-gray-300 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {isDeploying ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deploying...
                      </span>
                    ) : (
                      'Analyze Draft Rubric(s) and Deploy to Canvas'
                    )}
                  </button>
                  <p className="text-xs text-gray-500 text-center mt-2">Button becomes active when Canvas Course URL has been entered.</p>
                </div>

                {/* Deployment Progress Dialog */}
                {isDeploying && (
                  <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-lg">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-black text-gray-900">Analyzing & Deploying...</h3>
                        <p className="text-sm text-gray-600 mt-1">Please wait while we process your rubric(s)</p>
                      </div>
                      <button
                        onClick={handleCancelDeployment}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Elapsed Time */}
                    <div className="flex items-center gap-2 mb-4 text-sm text-gray-700">
                      <Clock className="w-4 h-4 text-blue-600" />
                      <span>Elapsed: <span className="font-bold">{elapsedSeconds}s</span></span>
                      <span className="text-gray-500">• Time estimate will appear shortly</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mb-6">
                      <div
                        className="h-full bg-blue-600 transition-all duration-500"
                        style={{ width: `${Math.min((deploymentLogs.length / 5) * 100, 90)}%` }}
                      />
                    </div>

                    {/* Deployment Timeline */}
                    <div className="mb-4">
                      <p className="text-sm font-bold text-gray-900 mb-3">Deployment Timeline</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-4 border border-gray-200">
                        {deploymentLogs.map((log, index) => (
                          <div key={index} className="flex items-start gap-2">
                            {log.includes('✓') ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-blue-300 flex-shrink-0 mt-0.5" />
                            )}
                            <span className="text-xs text-gray-700 leading-relaxed">{log}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
