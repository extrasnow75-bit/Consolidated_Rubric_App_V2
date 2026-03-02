import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, PointStyle, ProcessingType, GenerationSettings } from '../types';
import { generateRubricFromDescription, validateAssignmentDescription } from '../services/geminiService';
import { exportToWord } from '../services/wordExportService';
import { Loader2, Download, FileText, CheckCircle, ArrowRight, RotateCw, Home, Columns, X, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import ErrorDisplay from './ErrorDisplay';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { getRecentDocs, saveRecentDoc, RecentDoc } from '../utils/recentDocs';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

export const Part1Rubric: React.FC = () => {
  const {
    state,
    setCurrentStep,
    setRubric,
    setIsLoading,
    setError,
    newBatch,
    startProgress,
    stopProgress,
    setProgress,
    getAbortSignal,
    extractGoogleDocText,
    downloadDriveFile,
    startGoogleAuth,
    signOutGoogle,
    openGooglePicker,
  } = useSession();

  const [assignmentDescription, setAssignmentDescription] = useState<string>('');
  const [settings, setSettings] = useState<GenerationSettings>({
    totalPoints: 100,
    pointStyle: PointStyle.RANGE,
    processingType: ProcessingType.SINGLE,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const cancelRef = useRef<boolean>(false);

  // Google Docs URL state
  const [inputMode, setInputMode] = useState<'text' | 'google-doc'>('text');
  const [googleDocUrl, setGoogleDocUrl] = useState<string>('');
  const [fetchingGoogleDoc, setFetchingGoogleDoc] = useState(false);
  const [isPickerLoading, setIsPickerLoading] = useState(false);

  // File picker feedback & recent docs
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [recentDocs, setRecentDocs] = useState<RecentDoc[]>(() => getRecentDocs());
  const [showRecentDocs, setShowRecentDocs] = useState(false);

  // Side-by-side comparison
  const [showComparison, setShowComparison] = useState(false);
  const [snapshotDescription, setSnapshotDescription] = useState('');

  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const name = file.name.toLowerCase();

      if (name.endsWith('.docx') || name.endsWith('.doc')) {
        // Extract plain text from Word document using mammoth
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setAssignmentDescription(result.value);

      } else if (name.endsWith('.pdf')) {
        // Extract plain text from PDF using pdfjs-dist
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items
            .map((item: any) => item.str)
            .join(' ');
          pageTexts.push(pageText);
        }
        setAssignmentDescription(pageTexts.join('\n\n'));

      } else {
        // Plain text fallback (.txt and others)
        const text = await file.text();
        setAssignmentDescription(text);
      }
    } catch (err) {
      setError(`Failed to read file: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFetchGoogleDoc = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google first');
      return;
    }

    if (!googleDocUrl.trim()) {
      setError('Please enter a Google Docs URL');
      return;
    }

    setFetchingGoogleDoc(true);
    setError(null);

    try {
      const urlToSave = googleDocUrl.trim();
      const text = await extractGoogleDocText(googleDocUrl);
      setAssignmentDescription(text);
      saveRecentDoc({ name: urlToSave, url: urlToSave, source: 'url' });
      setRecentDocs(getRecentDocs());
      setInputMode('text'); // Switch to text view
      setGoogleDocUrl(''); // Clear URL field
    } catch (err: any) {
      setError(`Failed to fetch Google Doc: ${err.message}`);
    } finally {
      setFetchingGoogleDoc(false);
    }
  };

  const handlePickerOpen = async () => {
    if (!state.isGoogleAuthenticated) {
      setError('Please sign in with Google first');
      return;
    }

    setIsPickerLoading(true);
    setError(null);

    try {
      const result = await openGooglePicker();
      if (!result) return; // User cancelled

      setFetchingGoogleDoc(true);
      let text = '';

      if (result.mimeType === 'application/vnd.google-apps.document') {
        // Native Google Doc — use export API
        text = await extractGoogleDocText(result.fileId);

      } else if (
        result.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        result.mimeType === 'application/msword'
      ) {
        // Word document — download raw bytes and parse with mammoth
        const arrayBuffer = await downloadDriveFile(result.fileId);
        const extracted = await mammoth.extractRawText({ arrayBuffer });
        text = extracted.value;

      } else if (result.mimeType === 'application/pdf') {
        // PDF — download raw bytes and parse with pdfjs
        const arrayBuffer = await downloadDriveFile(result.fileId);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pageTexts.push(content.items.map((item: any) => item.str).join(' '));
        }
        text = pageTexts.join('\n\n');

      } else if (result.mimeType === 'text/plain') {
        // Plain text — download and decode
        const arrayBuffer = await downloadDriveFile(result.fileId);
        text = new TextDecoder().decode(arrayBuffer);

      } else {
        setError(`"${result.name}" is not a supported file type. Please select a Google Doc, Word document (.docx), PDF, or plain text file.`);
        return;
      }

      setAssignmentDescription(text);
      setPickedFileName(result.name);
      saveRecentDoc({ name: result.name, fileId: result.fileId, mimeType: result.mimeType, source: 'picker' });
      setRecentDocs(getRecentDocs());
      setInputMode('text');
      setGoogleDocUrl('');
    } catch (err: any) {
      setError(`Failed to open Google Drive: ${err.message}`);
    } finally {
      setIsPickerLoading(false);
      setFetchingGoogleDoc(false);
    }
  };

  const handleGenerateRubric = async () => {
    if (!assignmentDescription.trim()) {
      setError('Please enter an assignment description');
      return;
    }

    setSnapshotDescription(assignmentDescription);
    setIsGenerating(true);
    setError(null);
    cancelRef.current = false;

    startProgress(1, true);
    setProgress({ currentStep: 'Validating assignment description...' });

    try {
      // Step 1: Validate the assignment description
      const validation = await validateAssignmentDescription(assignmentDescription);

      const signal = getAbortSignal();
      if (signal.aborted) {
        setError('Rubric generation cancelled');
        return;
      }

      if (!validation.isValid) {
        setError('We couldn\'t recognize this as an assignment description. Please recheck your submission to make sure it is correct.');
        stopProgress();
        setIsGenerating(false);
        return;
      }

      // Step 2: Generate rubric criteria
      setProgress({ currentStep: 'Generating rubric criteria...', percentage: 0.3 });
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (signal.aborted) {
        setError('Rubric generation cancelled');
        return;
      }

      setProgress({ currentStep: 'Creating evaluation scales...', percentage: 0.5 });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const rubric = await generateRubricFromDescription(
        assignmentDescription,
        settings
      );

      if (signal.aborted) {
        setError('Rubric generation cancelled');
        return;
      }

      if (!cancelRef.current) {
        setProgress({ currentStep: 'Finalizing rubric...', percentage: 0.9 });
        setRubric(rubric);
        setProgress({ percentage: 1, itemsProcessed: 1 });
        setError(null);
        setTimeout(() => {
          stopProgress();
        }, 500);
      }
    } catch (err: any) {
      if (!getAbortSignal().aborted) {
        setError(`Failed to generate rubric: ${err.message}`);
      }
      stopProgress();
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportToWord = async () => {
    if (!state.rubric) return;
    try {
      await exportToWord(state.rubric);
    } catch (err: any) {
      setError(`Failed to export: ${err.message}`);
    }
  };

  const handleContinue = () => {
    if (!state.rubric) {
      setError('Please generate a rubric first');
      return;
    }
    setCurrentStep(AppMode.PART_2);
  };

  const handleReset = () => {
    setAssignmentDescription('');
    setRubric(null);
    setError(null);
    setPickedFileName(null);
    setSnapshotDescription('');
    setShowComparison(false);
  };

  const handleRecentDocClick = async (doc: RecentDoc) => {
    setShowRecentDocs(false);
    if (doc.source === 'url' && doc.url) {
      setGoogleDocUrl(doc.url);
      return;
    }
    if (doc.source === 'picker' && doc.fileId) {
      setIsPickerLoading(true);
      setError(null);
      try {
        let text = '';
        const mt = doc.mimeType || '';
        if (mt === 'application/vnd.google-apps.document') {
          text = await extractGoogleDocText(doc.fileId);
        } else if (mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mt === 'application/msword') {
          const ab = await downloadDriveFile(doc.fileId);
          const extracted = await mammoth.extractRawText({ arrayBuffer: ab });
          text = extracted.value;
        } else if (mt === 'application/pdf') {
          const ab = await downloadDriveFile(doc.fileId);
          const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
          const pages: string[] = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((item: any) => item.str).join(' '));
          }
          text = pages.join('\n\n');
        } else if (mt === 'text/plain') {
          const ab = await downloadDriveFile(doc.fileId);
          text = new TextDecoder().decode(ab);
        } else {
          text = await extractGoogleDocText(doc.fileId);
        }
        setAssignmentDescription(text);
        setPickedFileName(doc.name);
        setInputMode('text');
      } catch (err: any) {
        setError(`Failed to re-load document: ${err.message}`);
      } finally {
        setIsPickerLoading(false);
      }
    }
  };

  const handleDashboard = () => {
    newBatch();
    setCurrentStep(AppMode.DASHBOARD);
  };

  return (
    <div className="flex flex-col items-center justify-center py-8">
      {/* About Phase 1 - Above Main Section */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 max-w-2xl w-full">
        <h3 className="text-sm font-black text-gray-900 mb-1">About Phase 1</h3>
        <p className="text-sm text-gray-700">
          Upload or paste an assignment description to generate draft rubrics in MS Word form based on the eCampus Center template.
        </p>
      </div>

      <div className={`bg-white p-10 rounded-3xl shadow-2xl border border-gray-100 w-full transition-all duration-300 ${showComparison && state.rubric ? 'max-w-5xl' : 'max-w-2xl'}`}>
        {!state.rubric ? (
          <>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Create Draft Rubric</h2>
            <p className="text-gray-600 font-medium mb-8">
              Paste or upload an assignment description.
            </p>

            {/* Processing Type - Above Tabs */}
            <div className="mb-6 p-5 bg-gray-50 border border-gray-200 rounded-2xl">
              <label className="text-xs font-black text-gray-700 uppercase tracking-widest block mb-3">
                Processing Type
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="processingType"
                    value={ProcessingType.SINGLE}
                    checked={settings.processingType === ProcessingType.SINGLE}
                    onChange={() => setSettings({ ...settings, processingType: ProcessingType.SINGLE })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-700">Single Rubric</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="processingType"
                    value={ProcessingType.MULTIPLE}
                    checked={settings.processingType === ProcessingType.MULTIPLE}
                    onChange={() => setSettings({ ...settings, processingType: ProcessingType.MULTIPLE })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-700">Multiple Rubrics</span>
                </label>
              </div>
            </div>

            {/* Settings - Above Tabs */}
            <div className="mb-6 p-5 bg-gray-50 border border-gray-200 rounded-2xl">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-bold text-gray-700 block mb-2">
                    Total Points
                  </label>
                  <input
                    type="number"
                    value={settings.totalPoints}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        totalPoints: parseInt(e.target.value) || 100,
                      })
                    }
                    className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-gray-700 block mb-2">
                    Point Style
                  </label>
                  <div className="flex gap-4 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="pointStyle"
                        value={PointStyle.RANGE}
                        checked={settings.pointStyle === PointStyle.RANGE}
                        onChange={() => setSettings({ ...settings, pointStyle: PointStyle.RANGE })}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span className="text-sm font-medium text-gray-700">Ranges</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="pointStyle"
                        value={PointStyle.SINGLE}
                        checked={settings.pointStyle === PointStyle.SINGLE}
                        onChange={() => setSettings({ ...settings, pointStyle: PointStyle.SINGLE })}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span className="text-sm font-medium text-gray-700">Single Values</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Input Mode Toggle */}
            <div className="flex gap-3 mb-6 border-b border-gray-200">
              <button
                onClick={() => {
                  setInputMode('text');
                  setGoogleDocUrl('');
                  setError(null);
                }}
                className={`px-4 py-3 font-bold border-b-2 transition-all ${
                  inputMode === 'text'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Local Drive
              </button>
              <button
                onClick={() => {
                  setInputMode('google-doc');
                  setError(null);
                }}
                className={`px-4 py-3 font-bold border-b-2 transition-all ${
                  inputMode === 'google-doc'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Google Drive
              </button>
            </div>

            {inputMode === 'text' ? (
              <>
                {/* File Upload Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative w-full p-8 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                isDragging
                  ? 'bg-blue-50 border-blue-400'
                  : 'bg-gray-50 border-gray-200 hover:border-blue-300'
              }`}
            >
              <FileText className="w-8 h-8 text-gray-400" />
              <p className="text-sm font-bold text-gray-700">
                Drop a .txt, .docx, or .pdf file here or click to browse
              </p>
              <input
                type="file"
                accept=".txt,.docx,.pdf"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                className="hidden"
                id="file-input"
              />
              <label htmlFor="file-input" className="absolute inset-0 cursor-pointer" />
            </div>

            {/* Text Extraction Label */}
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-6 mb-2">
              Text Extraction
            </p>

            {/* Text Area */}
            <textarea
              value={assignmentDescription}
              onChange={(e) => setAssignmentDescription(e.target.value)}
              placeholder="Or paste your assignment description here..."
              className="w-full h-48 p-4 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />

            {/* Error Display */}
            {state.error && (
              <ErrorDisplay error={state.error} className="mt-6" />
            )}

                {/* Generate Button */}
                <button
                  onClick={handleGenerateRubric}
                  disabled={isGenerating || !assignmentDescription.trim()}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 mt-6 flex items-center justify-center gap-2"
                >
                  {isGenerating && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isGenerating ? 'Generating Rubric...' : 'Generate Rubric'}
                </button>
              </>
            ) : (
              <>
                {/* Google Account Status */}
                {state.isGoogleAuthenticated ? (
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
                    <p className="text-sm font-bold text-gray-700 mb-2">Google sign-in required</p>
                    <p className="text-xs text-gray-500 mb-3">Sign in to access Google Docs directly from your Drive.</p>
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
                  onClick={handlePickerOpen}
                  disabled={isPickerLoading || fetchingGoogleDoc || !state.isGoogleAuthenticated}
                  className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2 mb-6"
                >
                  {(isPickerLoading || fetchingGoogleDoc) ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 2H5C3.9 2 3 2.9 3 4v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 12 12 12s-3.5-1.57-3.5-3.5S10.07 5 12 5zm7 14H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
                    </svg>
                  )}
                  {isPickerLoading ? 'Opening Drive...' : fetchingGoogleDoc ? 'Fetching Document...' : 'Browse Google Drive'}
                </button>

                {/* Picked file feedback chip */}
                {pickedFileName && (
                  <div className="flex items-center gap-2 mb-4 mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                    <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-blue-800 truncate flex-1">{pickedFileName}</span>
                    <button onClick={() => setPickedFileName(null)} className="text-blue-400 hover:text-blue-600 flex-shrink-0 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Recent Documents */}
                {recentDocs.length > 0 && (
                  <div className="mb-6">
                    <button
                      onClick={() => setShowRecentDocs(!showRecentDocs)}
                      className="flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors mb-2"
                    >
                      <Clock className="w-4 h-4" />
                      Recent Documents
                      {showRecentDocs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {showRecentDocs && (
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        {recentDocs.map((doc, i) => (
                          <button
                            key={i}
                            onClick={() => handleRecentDocClick(doc)}
                            disabled={isPickerLoading}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-all text-left border-b border-gray-100 last:border-0 disabled:opacity-50"
                          >
                            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-800 truncate">{doc.name}</p>
                              <p className="text-xs text-gray-400">
                                {doc.source === 'picker' ? 'Drive Picker' : 'URL'} · {new Date(doc.timestamp).toLocaleDateString()}
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
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">or paste a URL</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Google Docs URL Input */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Google Docs URL
                  </label>
                  <input
                    type="url"
                    value={googleDocUrl}
                    onChange={(e) => setGoogleDocUrl(e.target.value)}
                    placeholder="Paste your shared Google Docs link (docs.google.com/document/d/...)"
                    className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                  />
                  <p className="text-xs text-gray-500 mb-4">
                    The document must be shared with you. Shared Google Docs links work with this feature.
                  </p>
                  <button
                    onClick={handleFetchGoogleDoc}
                    disabled={!googleDocUrl.trim() || fetchingGoogleDoc || !state.isGoogleAuthenticated}
                    className="w-full py-3 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm"
                  >
                    {fetchingGoogleDoc ? 'Fetching...' : 'Fetch Document'}
                  </button>
                </div>

                {/* Error Display */}
                {state.error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mt-6">
                    <p className="text-sm text-red-700 font-bold">{state.error}</p>
                  </div>
                )}

                {/* Generate Button */}
                <button
                  onClick={handleGenerateRubric}
                  disabled={isGenerating || !assignmentDescription.trim()}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 mt-6 flex items-center justify-center gap-2"
                >
                  {isGenerating && <Loader2 className="w-5 h-5 animate-spin" />}
                  {isGenerating ? 'Generating Rubric...' : 'Generate Rubric'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            {/* Inline Success Banner */}
            <div className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-2xl p-4 mb-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-black text-green-900">✓ Draft Rubric Created!</p>
                  <p className="text-sm text-green-700">Your draft rubric has been generated successfully.</p>
                </div>
              </div>
              {snapshotDescription && (
                <button
                  onClick={() => setShowComparison(!showComparison)}
                  className={`flex items-center gap-2 text-sm font-bold px-3 py-1.5 rounded-lg border transition-all flex-shrink-0 ${
                    showComparison
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <Columns className="w-4 h-4" />
                  {showComparison ? 'Hide Source' : 'View Source'}
                </button>
              )}
            </div>

            {/* Display Generated Rubric — comparison layout */}
            <div className={showComparison ? 'grid grid-cols-2 gap-8' : ''}>

              {/* Left column: original assignment text */}
              {showComparison && snapshotDescription && (
                <div className="flex flex-col">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">Original Assignment</h3>
                  <div className="flex-1 h-96 overflow-y-auto p-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 whitespace-pre-wrap leading-relaxed font-mono">
                    {snapshotDescription}
                  </div>
                </div>
              )}

              {/* Right column (or full width): rubric */}
              <div>
                <h3 className="text-xl font-black text-gray-900 mb-2">
                  {state.rubric.title}
                </h3>
                <p className="text-sm text-gray-600 mb-6">
                  {state.rubric.criteria.length} criteria • {state.rubric.totalPoints} points
                </p>

                {/* Preview Table */}
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

                {/* Primary Action */}
                <button
                  onClick={handleContinue}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all active:scale-95 mb-3 flex items-center justify-center gap-2"
                >
                  <ArrowRight className="w-5 h-5" />
                  Continue to Part 2: Convert to CSV
                </button>

                {/* Secondary Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={handleExportToWord}
                    className="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Export to Word
                  </button>
                  <button
                    onClick={handleReset}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-4 h-4" />
                    Create Another
                  </button>
                  <button
                    onClick={handleDashboard}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <Home className="w-4 h-4" />
                    Dashboard
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
