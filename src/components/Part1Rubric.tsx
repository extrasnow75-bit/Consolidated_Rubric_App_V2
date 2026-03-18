import React, { useState, useRef } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode, PointStyle, ProcessingType, GenerationSettings } from '../types';
import { generateRubricFromDescription } from '../services/geminiService';
import { exportToWord } from '../services/wordExportService';
import { Loader2, Download, FileText, CheckCircle, ArrowRight, RotateCw, Home, X, Clock, ChevronDown, ChevronUp, Link, Check } from 'lucide-react';
import { googleDriveService } from '../services/googleDriveService';
import ErrorDisplay from './ErrorDisplay';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import { getRecentDocs, saveRecentDoc, RecentDoc } from '../utils/recentDocs';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

interface Part1RubricProps {
  onAnalyzeDeploy?: () => void;
  canAnalyzeDeploy?: boolean;
}

export const Part1Rubric: React.FC<Part1RubricProps> = ({ onAnalyzeDeploy, canAnalyzeDeploy }) => {
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
    setCourseUrl,
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

  // Ready-for-Canvas confirmation checkbox
  const [readyForCanvas, setReadyForCanvas] = useState(false);

  // Inline replace card
  const [showReplaceCard, setShowReplaceCard] = useState(false);

  // Inline deploy card
  const [showDeployCard, setShowDeployCard] = useState(false);
  const [deployUrlInput, setDeployUrlInput] = useState(() => state.courseUrl || '');
  const [deployCourseName, setDeployCourseName] = useState<string | null>(null);
  const [deployCourseNameLoading, setDeployCourseNameLoading] = useState(false);

  const isCourseUrlValid = (url: string) =>
    /^https?:\/\/.+\/courses\/\d+/i.test(url.trim());

  const deployUrlValid = isCourseUrlValid(deployUrlInput);

  // Fetch course name when deploy URL becomes valid
  React.useEffect(() => {
    if (!deployUrlValid || !state.canvasApiToken) {
      setDeployCourseName(null);
      return;
    }
    let cancelled = false;
    setDeployCourseNameLoading(true);
    const fetchName = async () => {
      try {
        const url = new URL(deployUrlInput.trim());
        const match = url.pathname.match(/\/courses\/(\d+)/);
        if (!match) return;
        const courseId = match[1];
        const instanceUrl = `${url.protocol}//${url.host}`;
        const resp = await fetch(`/canvas-proxy/api/v1/courses/${courseId}`, {
          headers: {
            'Authorization': `Bearer ${state.canvasApiToken}`,
            'X-Canvas-Instance': instanceUrl,
          },
        });
        if (!cancelled && resp.ok) {
          const data = await resp.json();
          setDeployCourseName(data.name || null);
        }
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setDeployCourseNameLoading(false);
      }
    };
    fetchName();
    return () => { cancelled = true; };
  }, [deployUrlValid, deployUrlInput, state.canvasApiToken]);

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
    if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
      setError('Please sign in with Google first');
      return;
    }

    if (!googleDocUrl.trim()) {
      setError('Please enter a Google Drive URL');
      return;
    }

    setFetchingGoogleDoc(true);
    setError(null);

    try {
      const urlToSave = googleDocUrl.trim();
      const fileId = googleDriveService.extractFileIdFromUrl(urlToSave);
      const meta = await googleDriveService.verifyFileAccess(fileId, state.googleAccessToken);
      let text = '';

      if (meta.mimeType === 'application/vnd.google-apps.document') {
        text = await extractGoogleDocText(fileId);
      } else if (
        meta.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        meta.mimeType === 'application/msword'
      ) {
        const arrayBuffer = await downloadDriveFile(fileId);
        const extracted = await mammoth.extractRawText({ arrayBuffer });
        text = extracted.value;
      } else if (meta.mimeType === 'application/pdf') {
        const arrayBuffer = await downloadDriveFile(fileId);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pageTexts.push(content.items.map((item: any) => item.str).join(' '));
        }
        text = pageTexts.join('\n\n');
      } else if (meta.mimeType === 'text/plain') {
        const arrayBuffer = await downloadDriveFile(fileId);
        text = new TextDecoder().decode(arrayBuffer);
      } else {
        setError(`"${meta.name}" is not a supported file type. Please use a Google Doc, Word document (.docx), PDF, or plain text file.`);
        return;
      }

      setAssignmentDescription(text);
      saveRecentDoc({ name: meta.name, url: urlToSave, source: 'url' });
      setRecentDocs(getRecentDocs());
      setInputMode('text');
      setGoogleDocUrl('');
    } catch (err: any) {
      setError(`Failed to fetch from Google Drive: ${err.message}`);
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
    setProgress({ currentStep: 'Generating rubric criteria...' });

    try {
      const signal = getAbortSignal();
      if (signal.aborted) {
        setError('Rubric generation cancelled');
        return;
      }

      setProgress({ currentStep: 'Creating evaluation scales...', percentage: 0.3 });
      await new Promise((resolve) => setTimeout(resolve, 100));

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
        setShowReplaceCard(false);
        setReadyForCanvas(false);
        setShowDeployCard(false);
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

  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveSaveSuccess, setDriveSaveSuccess] = useState<string | null>(null);

  const handleSaveToDrive = async () => {
    if (!state.rubric || !state.googleAccessToken) return;
    setSavingToDrive(true);
    setDriveSaveSuccess(null);
    try {
      const folder = await googleDriveService.openFolderPicker(state.googleAccessToken);
      if (!folder) { setSavingToDrive(false); return; }

      // Format the rubric as readable plain text for a Google Doc
      const rubric = state.rubric;
      const lines: string[] = [
        rubric.title,
        '',
        ...rubric.criteria.flatMap(c => [
          `${c.category}`,
          c.description ? `  ${c.description}` : '',
          `  Exemplary (${c.exemplary.points} pts): ${c.exemplary.text}`,
          `  Proficient (${c.proficient.points} pts): ${c.proficient.text}`,
          `  Developing (${c.developing.points} pts): ${c.developing.text}`,
          `  Unsatisfactory (${c.unsatisfactory.points} pts): ${c.unsatisfactory.text}`,
          '',
        ]),
        `Total Points: ${rubric.totalPoints}`,
      ];
      const text = lines.join('\n');

      await googleDriveService.uploadFileToDrive(
        state.googleAccessToken,
        text,
        rubric.title,
        'text/plain',
        'application/vnd.google-apps.document',
        folder.folderId,
      );
      setDriveSaveSuccess(`Saved to "${folder.folderName}"`);
    } catch (err: any) {
      setError(`Google Drive save failed: ${err.message}`);
    } finally {
      setSavingToDrive(false);
    }
  };

  const handleContinue = () => {
    if (!state.rubric) {
      setError('Please generate a rubric first');
      return;
    }
    if (onAnalyzeDeploy) {
      onAnalyzeDeploy();
    } else {
      setCurrentStep(AppMode.PART_2);
    }
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
              Specify the type of rubric you'd like and then paste or upload an assignment description.
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
                From Local Drive
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
                From Google Drive
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
              <FileText className="w-8 h-8 text-gray-500" />
              <p className="text-sm font-bold text-gray-800">
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
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mt-6 mb-2">
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
                {assignmentDescription.trim() && (
                  <p className="text-xs text-gray-400 text-center mt-2 italic">
                    This usually takes less than a minute to generate a rubric.
                  </p>
                )}
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
                    <p className="text-xs text-gray-700 mb-3">Sign in to access Google Docs directly from your Drive.</p>
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
                      className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors mb-2"
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
                            <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-900 truncate">{doc.name}</p>
                              <p className="text-xs text-gray-600">
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
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">or paste a URL</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                {/* Google Drive URL Input */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Google Drive URL
                  </label>
                  <input
                    type="url"
                    value={googleDocUrl}
                    onChange={(e) => setGoogleDocUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleFetchGoogleDoc(); }}
                    placeholder="docs.google.com/document/d/… or drive.google.com/file/d/…"
                    className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                  />
                  <p className="text-xs text-gray-700 mb-4">
                    Supports Google Docs, Word (.docx), and PDF files stored in Drive. The file must be accessible to your signed-in account.
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

                {/* Success Banner — below table */}
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-black text-green-900">✓ Draft Rubric Created!</p>
                      <p className="text-sm text-green-700">Your draft rubric has been generated successfully.</p>
                      <p className="text-sm text-green-700 mt-1">We recommend making your own edits to this AI-generated rubric.</p>
                    </div>
                  </div>
                </div>

                {/* Secondary Actions */}
                <div className="flex gap-3 mb-3">
                  <button
                    onClick={handleExportToWord}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <Download className="w-4 h-4" />
                    Download as .docx
                  </button>
                  <button
                    onClick={handleSaveToDrive}
                    disabled={savingToDrive || !state.isGoogleAuthenticated}
                    className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 disabled:opacity-50 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    {savingToDrive ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 -960 960 960" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M220-100q-17 0-34.5-10.5T160-135L60-310q-8-14-8-34.5t8-34.5l260-446q8-14 25.5-24.5T380-860h200q17 0 34.5 10.5T640-825l182 312q-23-6-47.5-8t-48.5 2L574-780H386L132-344l94 164h316q11 23 25.5 43t33.5 37H220Zm70-180-29-51 183-319h72l101 176q-17 13-31.5 28.5T560-413l-80-139-110 192h164q-7 19-10.5 39t-3.5 41H290Zm430 160v-120H600v-80h120v-120h80v120h120v80H800v120h-80Z"/>
                      </svg>
                    )}
                    {savingToDrive ? 'Adding…' : 'Add to Drive'}
                  </button>
                  <button
                    onClick={() => setShowReplaceCard(true)}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-4 h-4" />
                    Replace Draft Rubric
                  </button>
                  <button
                    onClick={handleDashboard}
                    className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-all text-sm flex items-center justify-center gap-2"
                  >
                    <Home className="w-4 h-4" />
                    Back to Dashboard
                  </button>
                </div>

                {driveSaveSuccess && (
                  <p className="text-xs text-green-700 font-bold text-center mb-3">✓ {driveSaveSuccess}</p>
                )}
                {!state.isGoogleAuthenticated && (
                  <p className="text-xs text-gray-400 text-center mb-3">Sign in with Google on the Dashboard to enable Add to Drive.</p>
                )}

                {/* Ready confirmation checkbox */}
                {onAnalyzeDeploy && (
                  <label className="flex items-start gap-3 mb-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={readyForCanvas}
                      onChange={(e) => {
                        setReadyForCanvas(e.target.checked);
                        if (!e.target.checked) setShowDeployCard(false);
                      }}
                      className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0"
                    />
                    <span className="text-sm text-gray-700">
                      No further revision is needed. The rubric currently displayed above is ready for Canvas.
                    </span>
                  </label>
                )}

                {/* Deploy Action — bottom */}
                <button
                  onClick={() => {
                    if (onAnalyzeDeploy) {
                      setShowDeployCard(true);
                    } else {
                      handleContinue();
                    }
                  }}
                  disabled={!!(onAnalyzeDeploy && (!canAnalyzeDeploy || !readyForCanvas))}
                  className={`w-full py-4 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-green-700 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${showDeployCard ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <ArrowRight className="w-5 h-5" />
                  {onAnalyzeDeploy ? 'Deploy Displayed Rubric to Canvas' : 'Continue to Part 2: Convert to CSV'}
                </button>

                {/* Inline Canvas Course URL card */}
                {showDeployCard && onAnalyzeDeploy && (
                  <div className={`mt-4 bg-white rounded-2xl border-2 p-6 shadow-sm transition-all duration-300 ${
                    deployUrlValid
                      ? 'border-green-400 ring-2 ring-green-300 ring-offset-1 shadow-green-100'
                      : 'border-gray-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Link className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <h3 className="font-black text-lg text-gray-900">Target Canvas Course</h3>
                      {deployUrlValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
                    </div>
                    <p className="text-sm text-gray-600 mb-3">Enter the homepage URL of the Canvas course you want to deploy this rubric to.</p>
                    <input
                      type="url"
                      value={deployUrlInput}
                      onChange={(e) => {
                        setDeployUrlInput(e.target.value);
                        setDeployCourseName(null);
                      }}
                      placeholder="https://canvas.institution.edu/courses/12345"
                      className={`w-full px-4 py-3 border-2 rounded-xl text-sm focus:outline-none transition-all ${
                        deployUrlInput && !deployUrlValid
                          ? 'border-red-300 focus:border-red-400'
                          : deployUrlValid
                          ? 'border-green-400 focus:border-green-500'
                          : 'border-gray-200 focus:border-blue-400'
                      }`}
                    />
                    {deployUrlInput && !deployUrlValid && (
                      <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                        <X className="w-3 h-3" /> URL must include a /courses/&lt;ID&gt; path
                      </p>
                    )}
                    {deployUrlValid && (
                      <div className="mt-3 flex items-center gap-2 min-h-[1.5rem]">
                        {deployCourseNameLoading ? (
                          <Loader2 className="w-4 h-4 text-green-500 animate-spin" />
                        ) : deployCourseName ? (
                          <>
                            <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                            <span className="text-sm font-bold text-green-700">{deployCourseName}</span>
                          </>
                        ) : null}
                      </div>
                    )}
                    <div className="flex gap-3 mt-5">
                      <button
                        onClick={() => setShowDeployCard(false)}
                        className="flex-1 py-3 px-4 bg-gray-100 text-gray-700 rounded-2xl font-bold hover:bg-gray-200 transition-all text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (!deployUrlValid) return;
                          setCourseUrl(deployUrlInput.trim());
                          handleContinue();
                        }}
                        disabled={!deployUrlValid}
                        className="flex-[2] py-3 px-6 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-green-700 transition-all shadow-lg flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ArrowRight className="w-4 h-4" />
                        Deploy Now
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Replace Draft Rubric card — appears below main card */}
      {showReplaceCard && state.rubric && (
        <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 w-full max-w-2xl mt-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-black text-gray-900">Replace Draft Rubric</h3>
              <p className="text-sm text-gray-600 mt-1">Generate a new rubric to replace the one currently displayed.</p>
            </div>
            <button
              onClick={() => setShowReplaceCard(false)}
              className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0 ml-4"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-4 mb-6 p-4 bg-gray-50 border border-gray-200 rounded-2xl">
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">Total Points</label>
              <input
                type="number"
                value={settings.totalPoints}
                onChange={(e) => setSettings({ ...settings, totalPoints: parseInt(e.target.value) || 100 })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-bold text-gray-700 block mb-2">Point Style</label>
              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="replace-pointStyle" value="range" checked={(settings.pointStyle as string) === 'range'} onChange={() => setSettings({ ...settings, pointStyle: 'range' as any })} className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm font-medium text-gray-700">Ranges</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="replace-pointStyle" value="single" checked={(settings.pointStyle as string) === 'single'} onChange={() => setSettings({ ...settings, pointStyle: 'single' as any })} className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm font-medium text-gray-700">Single Values</span>
                </label>
              </div>
            </div>
          </div>

          {/* Input mode tabs */}
          <div className="flex gap-3 mb-6 border-b border-gray-200">
            <button
              onClick={() => { setInputMode('text'); setGoogleDocUrl(''); setError(null); }}
              className={`px-4 py-3 font-bold border-b-2 transition-all ${inputMode === 'text' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              From Local Drive
            </button>
            <button
              onClick={() => { setInputMode('google-doc'); setError(null); }}
              className={`px-4 py-3 font-bold border-b-2 transition-all ${inputMode === 'google-doc' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              From Google Drive
            </button>
          </div>

          {inputMode === 'text' ? (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files[0]) handleFileUpload(e.dataTransfer.files[0]); }}
                className={`relative w-full p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all mb-4 ${isDragging ? 'bg-blue-50 border-blue-400' : 'bg-gray-50 border-gray-200 hover:border-blue-300'}`}
              >
                <FileText className="w-7 h-7 text-gray-500" />
                <p className="text-sm font-bold text-gray-800">Drop a .txt, .docx, or .pdf file here or click to browse</p>
                <input type="file" accept=".txt,.docx,.pdf" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0]); }} className="hidden" id="replace-file-input" />
                <label htmlFor="replace-file-input" className="absolute inset-0 cursor-pointer" />
              </div>
              <textarea
                value={assignmentDescription}
                onChange={(e) => setAssignmentDescription(e.target.value)}
                placeholder="Or paste your assignment description here..."
                className="w-full h-40 p-4 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-4"
              />
            </>
          ) : (
            <div className="mb-4">
              {state.isGoogleAuthenticated ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
                  <span className="text-sm font-bold text-green-900">{state.googleUser?.name}</span>
                  <button onClick={() => signOutGoogle()} className="text-xs font-bold text-green-700 hover:text-green-900">Sign Out</button>
                </div>
              ) : (
                <button onClick={() => startGoogleAuth()} className="w-full py-2.5 px-4 bg-white border border-gray-300 rounded-lg font-bold text-sm text-gray-700 hover:bg-gray-50 transition-all flex items-center justify-center gap-2 mb-4">
                  Sign in with Google
                </button>
              )}
              <button
                onClick={handlePickerOpen}
                disabled={isPickerLoading || fetchingGoogleDoc || !state.isGoogleAuthenticated}
                className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-300 transition-all text-sm flex items-center justify-center gap-2 mb-4"
              >
                {(isPickerLoading || fetchingGoogleDoc) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isPickerLoading ? 'Opening Drive...' : fetchingGoogleDoc ? 'Fetching...' : 'Browse Google Drive'}
              </button>
              <input
                type="url"
                value={googleDocUrl}
                onChange={(e) => setGoogleDocUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleFetchGoogleDoc(); }}
                placeholder="Or paste a Google Drive URL..."
                className="w-full px-4 py-3 border rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none mb-2"
              />
              <button
                onClick={handleFetchGoogleDoc}
                disabled={!googleDocUrl.trim() || fetchingGoogleDoc || !state.isGoogleAuthenticated}
                className="w-full py-2.5 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm"
              >
                {fetchingGoogleDoc ? 'Fetching...' : 'Fetch Document'}
              </button>
            </div>
          )}

          {state.error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl mb-4">
              <p className="text-sm text-red-700 font-bold">{state.error}</p>
            </div>
          )}

          <button
            onClick={handleGenerateRubric}
            disabled={isGenerating || !assignmentDescription.trim()}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:bg-gray-300 active:scale-95 flex items-center justify-center gap-2"
          >
            {isGenerating && <Loader2 className="w-5 h-5 animate-spin" />}
            {isGenerating ? 'Generating Rubric...' : 'Generate Replacement Rubric'}
          </button>
        </div>
      )}
    </div>
  );
};
