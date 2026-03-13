import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, PointStyle, ProcessingType, GenerationSettings } from '../types';
import { generateRubricFromScreenshot } from '../services/geminiService';
import { exportToWord } from '../services/wordExportService';
import { Upload, Download, Loader2, Trash2, Image as ImageIcon, HardDrive, FolderOpen, Clipboard } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';

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
  } = useSession();

  const googleSignedIn = state.isGoogleAuthenticated;
  const googleAccessToken = state.googleAccessToken;

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

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

  // Global paste listener — works anywhere on the page when no image loaded
  const imagePreviewRef = useRef(imagePreview);
  imagePreviewRef.current = imagePreview;

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (imagePreviewRef.current) return; // already loaded
      extractImageFromClipboard(e.clipboardData as unknown as DataTransfer);
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [extractImageFromClipboard]);

  const handlePasteAreaPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    extractImageFromClipboard(e.clipboardData);
  };

  // ── Google Drive picker ────────────────────────────────────────────────────

  const handleGooglePickerImage = async () => {
    try {
      const result = await openGooglePicker();
      if (!result) return;
      const buffer = await downloadDriveFile(result.fileId);
      const mimeType = result.mimeType || 'image/png';
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const base64 = btoa(binary);
      const dataUrl = `data:${mimeType};base64,${base64}`;
      setImageFile({ data: base64, mimeType });
      setImagePreview(dataUrl);
    } catch (err: any) {
      setError(`Google Drive error: ${err.message}`);
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
            <p className="text-sm font-black text-gray-700 uppercase tracking-wide mb-2">
              Instructions
            </p>
            <ol className="space-y-2 mb-6 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="font-black text-[#0033a0] flex-shrink-0">1.</span>
                <span>
                  Take a screenshot of the <span className="font-semibold text-gray-800">full rubric</span>.
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
                <span className="font-black text-[#0033a0] flex-shrink-0">2.</span>
                <span>Upload the screenshot using one of the options below.</span>
              </li>
            </ol>

            {!imagePreview ? (
              <>
                {/* Drag & drop zone with Local Drive + Google Drive buttons */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative w-full p-6 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 transition-all ${
                    isDragging
                      ? 'bg-blue-50 border-blue-400'
                      : 'bg-gray-50 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <ImageIcon className="w-8 h-8 text-gray-400" />
                  <p className="text-sm font-bold text-gray-600">
                    Drag & drop a screenshot here
                  </p>

                  {/* Upload buttons */}
                  <div className="flex gap-3 w-full">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700 rounded-xl font-bold text-sm transition-all"
                    >
                      <HardDrive className="w-4 h-4 flex-shrink-0" />
                      Local Drive
                    </button>
                    <button
                      type="button"
                      onClick={handleGooglePickerImage}
                      disabled={!googleSignedIn}
                      title={!googleSignedIn ? 'Sign in with Google in Initial Setup to use this option' : undefined}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-gray-700 rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:bg-white"
                    >
                      <FolderOpen className="w-4 h-4 flex-shrink-0" />
                      Google Drive
                    </button>
                  </div>

                  <p className="text-xs text-gray-400">PNG, JPG, WebP supported</p>

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
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">or</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Paste from clipboard area */}
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
                  <Clipboard className={`w-5 h-5 transition-colors ${isPasteFocused ? 'text-blue-500' : 'text-gray-400'}`} />
                  <p className={`text-sm font-bold transition-colors ${isPasteFocused ? 'text-blue-700' : 'text-gray-600'}`}>
                    {isPasteFocused ? 'Ready — press Ctrl+V (or ⌘+V) to paste' : 'Click here to paste from clipboard'}
                  </p>
                  <p className="text-xs text-gray-400">
                    You can also paste anywhere on this page after copying a screenshot
                  </p>
                </div>
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

              <button
                onClick={handleExportToWord}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2 mb-3"
              >
                <Download className="w-5 h-5" />
                Download as .docx
              </button>

              <button
                onClick={handleReset}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-300 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 className="w-5 h-5" />
                Convert Another
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
