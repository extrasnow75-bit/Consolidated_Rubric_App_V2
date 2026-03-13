import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import {
  Key, Check, X, Loader2, ExternalLink, Eye, EyeOff,
  LogOut, Link, FileText, Upload, ChevronDown, FolderOpen, Settings2,
  Lightbulb, Camera, ArrowRight, Clipboard, HardDrive,
} from 'lucide-react';
import { googleDriveService } from '../services/googleDriveService';
import { AppMode } from '../types';
import { validateGeminiApiKey } from '../services/geminiService';
import { AnalyzeDeploySection, UploadedDocFile } from './AnalyzeDeploySection';
import { Part1Rubric } from './Part1Rubric';
import { ScreenshotConverter } from './ScreenshotConverter';

// ─── Google Icon ──────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" />
  </svg>
);

// ─── Card wrapper with green-glow ─────────────────────────────────────────────

const SetupCard: React.FC<{
  children: React.ReactNode;
  isValid: boolean;
  isOptional?: boolean;
  noGlow?: boolean;
}> = ({ children, isValid, isOptional = false, noGlow = false }) => (
  <div
    className={`bg-white rounded-2xl border-2 p-6 shadow-sm transition-all duration-300 ${
      isValid && !noGlow
        ? 'border-green-400 ring-2 ring-green-300 ring-offset-1 shadow-green-100'
        : isValid && noGlow
        ? 'border-green-300'
        : isOptional
        ? 'border-gray-100'
        : 'border-gray-200'
    }`}
  >
    {children}
  </div>
);

// ─── Course URL validator ─────────────────────────────────────────────────────

const isCourseUrlValid = (url: string) =>
  /^https?:\/\/.+\/courses\/\d+/i.test(url.trim());

// ─── Main Component ───────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const {
    state,
    startGoogleAuth,
    signOutGoogle,
    setUserGeminiApiKey,
    setUserCanvasApiToken,
    setCourseUrl,
    setCurrentStep,
    setHelpOpen,
    openGooglePicker,
    downloadDriveFile,
  } = useSession();

  // ── Gemini API Key ──
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidationResult, setKeyValidationResult] = useState<'idle' | 'valid' | 'invalid'>('idle');

  // ── Canvas Token ──
  const [canvasTokenInput, setCanvasTokenInput] = useState('');
  const [showCanvasToken, setShowCanvasToken] = useState(false);
  const [canvasTokenError, setCanvasTokenError] = useState<string | null>(null);

  // ── Course URL ──
  const [courseUrlInput, setCourseUrlInput] = useState(state.courseUrl || '');
  const courseUrlValid = isCourseUrlValid(courseUrlInput);

  // ── Course Name ──
  const [courseName, setCourseName] = useState<string | null>(null);
  const [courseNameLoading, setCourseNameLoading] = useState(false);

  // ── Draft Rubric Document ──
  const [hasDraftRubric, setHasDraftRubricLocal] = useState<'' | 'yes' | 'no'>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedDocFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isPasteAreaFocused, setIsPasteAreaFocused] = useState(false);
  const [docUploadTab, setDocUploadTab] = useState<'local' | 'google'>('local');
  const [driveUrl, setDriveUrl] = useState('');
  const [isFetchingDriveUrl, setIsFetchingDriveUrl] = useState(false);
  const [driveUrlError, setDriveUrlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // ── Analyze & Deploy ──
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeRubricSource, setAnalyzeRubricSource] = useState<'yes' | 'no' | null>(null);
  const analyzeRef = useRef<HTMLDivElement>(null);

  // ── Phase 1 inline mode ──
  const [phase1Mode, setPhase1Mode] = useState<'none' | 'rubric' | 'screenshot'>('none');

  // ─── Derived validity ────────────────────────────────────────────────────────

  const geminiValid = !!state.geminiApiKey;
  const canvasTokenValid = !!state.canvasApiToken;
  const googleSignedIn = state.isGoogleAuthenticated;
  const draftRubricValid =
    hasDraftRubric === 'yes' ? uploadedFiles.length > 0 : hasDraftRubric === 'no';

  // Core setup = Gemini + Canvas Token (determines when workflow cards appear)
  const coreSetupComplete = geminiValid && canvasTokenValid;

  // All setup done (including optional Google) = when collapsible auto-closes
  const allSetupComplete = geminiValid && canvasTokenValid && googleSignedIn;

  const allRequiredValid = geminiValid && canvasTokenValid && courseUrlValid && draftRubricValid;

  // ── Initial Setup header status text ──
  const requiredRemaining = [!geminiValid, !canvasTokenValid].filter(Boolean).length;
  const setupStatusText = allSetupComplete
    ? 'Complete'
    : requiredRemaining === 0 && !googleSignedIn
    ? 'Optional: Sign in to Google?'
    : `${requiredRemaining} item${requiredRemaining === 1 ? '' : 's'} remaining`;
  const setupStatusColor = allSetupComplete ? 'text-green-400' : 'text-white/90';

  // ── Collapsible Initial Setup ──
  const [isSetupOpen, setIsSetupOpen] = useState(!allSetupComplete);

  // Auto-collapse only when all three setup items are complete (including Google)
  useEffect(() => {
    if (allSetupComplete) setIsSetupOpen(false);
  }, [allSetupComplete]);

  // ── Fetch course name when URL and token are both valid ──
  useEffect(() => {
    if (!courseUrlValid || !canvasTokenValid) {
      setCourseName(null);
      return;
    }
    let cancelled = false;
    setCourseNameLoading(true);
    const fetchCourseName = async () => {
      try {
        const url = new URL(courseUrlInput.trim());
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
          setCourseName(data.name || null);
        }
      } catch {
        // silently ignore network errors
      } finally {
        if (!cancelled) setCourseNameLoading(false);
      }
    };
    fetchCourseName();
    return () => { cancelled = true; };
  }, [courseUrlValid, canvasTokenValid, courseUrlInput, state.canvasApiToken]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const maskKey = (key: string) =>
    key.length <= 8 ? key : key.substring(0, 8) + '\u2026' + key.substring(key.length - 4);

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsValidatingKey(true);
    setKeyValidationResult('idle');
    const isValid = await validateGeminiApiKey(apiKeyInput.trim());
    if (isValid) {
      setKeyValidationResult('valid');
      setUserGeminiApiKey(apiKeyInput.trim());
      setApiKeyInput('');
    } else {
      setKeyValidationResult('invalid');
    }
    setIsValidatingKey(false);
  };

  const handleRemoveApiKey = () => {
    setUserGeminiApiKey(null);
    setKeyValidationResult('idle');
    setApiKeyInput('');
  };

  const handleSaveCanvasToken = () => {
    const trimmed = canvasTokenInput.trim();
    if (!trimmed) return;
    if (trimmed.length < 20) {
      setCanvasTokenError('Token looks too short — Canvas tokens are usually 64+ characters.');
      return;
    }
    if (/[\s<>"'`]/.test(trimmed)) {
      setCanvasTokenError('Token contains invalid characters. Please paste only the token itself.');
      return;
    }
    setCanvasTokenError(null);
    setUserCanvasApiToken(trimmed);
    setCanvasTokenInput('');
  };

  const handleRemoveCanvasToken = () => setUserCanvasApiToken(null);

  const handleCourseUrlChange = (val: string) => {
    setCourseUrlInput(val);
    if (isCourseUrlValid(val)) setCourseUrl(val.trim());
    else setCourseUrl(null);
  };

  const handleDraftRubricChange = (val: '' | 'yes' | 'no') => {
    setHasDraftRubricLocal(val);
    setPhase1Mode('none');
    if (val === 'no') {
      setUploadedFiles([]);
      setShowAnalyze(false);
    }
    if (val === 'yes') {
      setShowAnalyze(false);
    }
  };

  // ── File handling ──

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const docs = arr.filter((f) =>
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      f.type === 'application/msword' ||
      f.name.endsWith('.docx') ||
      f.name.endsWith('.doc'),
    );
    if (docs.length === 0) return;
    const converted = await Promise.all(
      docs.map(async (f) => ({
        name: f.name,
        data: await readFileAsBase64(f),
        mimeType:
          f.type ||
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })),
    );
    setUploadedFiles((prev) => {
      const existingNames = new Set(prev.map((p) => p.name));
      return [...prev, ...converted.filter((c) => !existingNames.has(c.name))];
    });
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      await addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) await addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles],
  );

  const handlePasteAreaPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = Array.from(e.clipboardData.items);
      const fileItem = items.find((item) =>
        item.kind === 'file' &&
        (item.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          item.type === 'application/msword' ||
          item.type === '')
      );
      if (fileItem) {
        const file = fileItem.getAsFile();
        if (file) {
          const list = new DataTransfer();
          list.items.add(file);
          await addFiles(list.files);
        }
      }
    },
    [addFiles],
  );

  const handleGooglePicker = async () => {
    try {
      const result = await openGooglePicker();
      if (!result) return;

      const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      let buffer: ArrayBuffer;
      let fileName = result.name;

      if (result.mimeType === 'application/vnd.google-apps.document') {
        if (!fileName.toLowerCase().endsWith('.docx')) fileName = `${fileName}.docx`;
        const exportUrl =
          `https://www.googleapis.com/drive/v3/files/${result.fileId}/export` +
          `?mimeType=${encodeURIComponent(DOCX_MIME)}`;
        const resp = await fetch(exportUrl, {
          headers: { Authorization: `Bearer ${state.googleAccessToken}` },
        });
        if (!resp.ok) throw new Error(`Google Drive export failed (${resp.status})`);
        buffer = await resp.arrayBuffer();
      } else {
        buffer = await downloadDriveFile(result.fileId);
      }

      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const base64 = btoa(binary);
      setUploadedFiles((prev) => {
        if (prev.some((p) => p.name === fileName)) return prev;
        return [...prev, { name: fileName, data: base64, mimeType: DOCX_MIME }];
      });
    } catch (err: any) {
      console.error('Google Picker error:', err);
    }
  };

  const handleFetchFromDriveUrl = async () => {
    if (!driveUrl.trim() || !state.googleAccessToken) return;
    setIsFetchingDriveUrl(true);
    setDriveUrlError(null);
    try {
      const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const fileId = googleDriveService.extractFileIdFromUrl(driveUrl.trim());
      const meta = await googleDriveService.verifyFileAccess(fileId, state.googleAccessToken);
      let buffer: ArrayBuffer;
      let fileName = meta.name;
      if (meta.mimeType === 'application/vnd.google-apps.document') {
        if (!fileName.toLowerCase().endsWith('.docx')) fileName = `${fileName}.docx`;
        const exportUrl =
          `https://www.googleapis.com/drive/v3/files/${fileId}/export` +
          `?mimeType=${encodeURIComponent(DOCX_MIME)}`;
        const resp = await fetch(exportUrl, { headers: { Authorization: `Bearer ${state.googleAccessToken}` } });
        if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
        buffer = await resp.arrayBuffer();
      } else {
        buffer = await googleDriveService.downloadFileAsArrayBuffer(fileId, state.googleAccessToken);
      }
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const base64 = btoa(binary);
      setUploadedFiles((prev) => {
        if (prev.some((p) => p.name === fileName)) return prev;
        return [...prev, { name: fileName, data: base64, mimeType: DOCX_MIME }];
      });
      setDriveUrl('');
    } catch (err: any) {
      setDriveUrlError(`Could not fetch file: ${err.message}`);
    } finally {
      setIsFetchingDriveUrl(false);
    }
  };

  const handleAnalyzeDeploy = (source: 'yes' | 'no') => {
    setAnalyzeRubricSource(source);
    setShowAnalyze(true);
    setTimeout(() => analyzeRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">

      <div className="space-y-4">

        {/* ── Initial Setup Collapsible ── */}
        <div className="rounded-2xl overflow-hidden shadow-md">

          {/* Header */}
          <button
            onClick={() => setIsSetupOpen((v) => !v)}
            className="w-full bg-[#0033a0] hover:bg-[#002d8f] text-white px-6 py-4 flex items-center gap-3 transition-colors cursor-pointer text-left"
          >
            <Settings2 className="w-5 h-5 flex-shrink-0" />
            <span className="font-black text-base">Initial Setup</span>
            <div className="ml-auto flex items-center gap-3">
              {/* Status dots + text */}
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <div
                    title="Gemini API Key"
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${geminiValid ? 'bg-green-400' : 'bg-white/30'}`}
                  />
                  <div
                    title="Canvas API Token"
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${canvasTokenValid ? 'bg-green-400' : 'bg-white/30'}`}
                  />
                  <div
                    title="Google Sign-In (optional)"
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${googleSignedIn ? 'bg-green-400 opacity-80' : 'bg-white/20'}`}
                  />
                </div>
                <span className={`text-xs font-bold leading-none ${setupStatusColor}`}>
                  {setupStatusText}
                </span>
              </div>
              <ChevronDown
                className={`w-5 h-5 transition-transform duration-300 ${isSetupOpen ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {/* Collapsible body */}
          {isSetupOpen && (
            <div className="bg-gray-50 px-4 pb-4 pt-3 space-y-3 border border-gray-100 border-t-0 rounded-b-2xl">

              {/* Card 1: Gemini API Key */}
              <SetupCard isValid={geminiValid}>
                <div className="flex items-center gap-2 mb-1">
                  <Key className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <h3 className="font-black text-lg text-gray-900">Gemini API Key</h3>
                  {geminiValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
                </div>
                {geminiValid ? (
                  <div>
                    <div className="flex items-center gap-2 mt-2 mb-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-sm font-bold text-green-700">API key active</span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono mb-3 break-all">{maskKey(state.geminiApiKey!)}</p>
                    <button onClick={handleRemoveApiKey} className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all text-sm flex items-center justify-center gap-2">
                      <LogOut className="w-4 h-4" /> Remove Key
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">Enter your free Google Gemini API key to enable AI features.</p>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => { setApiKeyInput(e.target.value); setKeyValidationResult('idle'); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                      placeholder="Paste your API key here..."
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono focus:border-amber-400 focus:outline-none transition-all mb-3"
                    />
                    {keyValidationResult === 'invalid' && (
                      <div className="flex items-center gap-2 mb-3 text-red-600">
                        <X className="w-4 h-4" />
                        <span className="text-xs font-bold">Invalid API key. Please check and try again.</span>
                      </div>
                    )}
                    <button
                      onClick={handleSaveApiKey}
                      disabled={!apiKeyInput.trim() || isValidatingKey}
                      className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 transition-all text-sm disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                    >
                      {isValidatingKey ? <><Loader2 className="w-4 h-4 animate-spin" /> Validating...</> : <><Check className="w-4 h-4" /> Save Key</>}
                    </button>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 mt-3 text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline">
                      Get a free key at aistudio.google.com <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </SetupCard>

              {/* Card 2: Canvas API Token */}
              <SetupCard isValid={canvasTokenValid}>
                <div className="flex items-center gap-2 mb-1">
                  <Key className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <h3 className="font-black text-lg text-gray-900">Canvas API Token</h3>
                  {canvasTokenValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
                </div>
                {canvasTokenValid ? (
                  <div>
                    <div className="flex items-center gap-2 mt-2 mb-1">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-sm font-bold text-green-700">Token saved</span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono mb-3 break-all">{maskKey(state.canvasApiToken!)}</p>
                    <button onClick={handleRemoveCanvasToken} className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all text-sm flex items-center justify-center gap-2">
                      <LogOut className="w-4 h-4" /> Remove Token
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600 mb-3">Required for deploying rubrics to Canvas. Generate a token from your Canvas account settings.</p>
                    <div className="relative mb-3">
                      <input
                        type={showCanvasToken ? 'text' : 'password'}
                        value={canvasTokenInput}
                        onChange={(e) => { setCanvasTokenInput(e.target.value); setCanvasTokenError(null); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveCanvasToken()}
                        placeholder="Paste your Canvas token here..."
                        className={`w-full px-4 py-3 border-2 rounded-xl text-sm font-mono focus:outline-none transition-all pr-10 ${canvasTokenError ? 'border-red-400' : 'border-gray-200 focus:border-red-400'}`}
                      />
                      <button type="button" onClick={() => setShowCanvasToken((v) => !v)} className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600">
                        {showCanvasToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {canvasTokenError && (
                      <p className="text-xs text-red-600 mb-3 flex items-start gap-1">
                        <X className="w-3 h-3 mt-0.5 flex-shrink-0" /> {canvasTokenError}
                      </p>
                    )}
                    <button
                      onClick={handleSaveCanvasToken}
                      disabled={!canvasTokenInput.trim()}
                      className="w-full px-4 py-3 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 transition-all text-sm disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" /> Save Token
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('openHelpSection', { detail: 'canvas-setup' }));
                        setHelpOpen(true);
                      }}
                      className="w-full mt-2 text-sm text-blue-600 hover:text-blue-800 font-bold hover:underline text-center"
                    >
                      How do I get one?
                    </button>
                  </div>
                )}
              </SetupCard>

              {/* Card 3: Google Sign-In (optional) — after Canvas Token */}
              <SetupCard isValid={googleSignedIn} isOptional>
                {!googleSignedIn ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <GoogleIcon />
                      <h3 className="font-black text-lg text-gray-900">Google Sign-In</h3>
                      <span className="ml-auto text-xs text-gray-400 font-bold uppercase tracking-wide">Optional</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">Sign in to select rubric documents directly from Google Drive.</p>
                    <button
                      onClick={() => startGoogleAuth()}
                      disabled={state.isAuthenticating}
                      className="w-full px-6 py-3 bg-white border-2 border-blue-400 text-blue-600 rounded-xl font-black hover:bg-blue-50 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {state.isAuthenticating ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in...</> : <><GoogleIcon /> Sign In with Google</>}
                    </button>
                    {state.googleAuthError && (
                      <p className="text-xs text-red-600 mt-2 flex items-start gap-1">
                        <X className="w-3 h-3 mt-0.5 flex-shrink-0" /> {state.googleAuthError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    {state.googleUser?.picture && (
                      <img src={state.googleUser.picture} alt="Profile" className="w-12 h-12 rounded-full border-2 border-green-300 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-gray-900 truncate">{state.googleUser?.name}</p>
                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                      </div>
                      <p className="text-xs text-gray-500 truncate">{state.googleUser?.email}</p>
                    </div>
                    <button onClick={() => signOutGoogle()} className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all text-xs flex items-center gap-1 flex-shrink-0">
                      <LogOut className="w-3 h-3" /> Sign Out
                    </button>
                  </div>
                )}
              </SetupCard>

            </div>
          )}
        </div>

        {/* ── Draft Rubric Document — appears once core setup is complete ── */}
        {coreSetupComplete && (
          <SetupCard isValid={draftRubricValid} noGlow>
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 flex-shrink-0" style={{ color: '#4285F4' }} />
              <h3 className="font-black text-lg text-gray-900">Draft Rubric Document</h3>
              {draftRubricValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
            </div>
            <p className="text-sm text-gray-600 mb-3">Do you already have a draft rubric document ready to deploy?</p>

            <div className="relative mb-4">
              <select
                value={hasDraftRubric}
                onChange={(e) => handleDraftRubricChange(e.target.value as '' | 'yes' | 'no')}
                className="w-full appearance-none px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0033a0] focus:outline-none transition-all bg-white font-medium text-gray-700 cursor-pointer"
              >
                <option value="">Select...</option>
                <option value="yes">Yes - I have a draft rubric document</option>
                <option value="no">No - I need to create one first</option>
              </select>
              <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>

            {/* "Yes" path — tabbed file upload area */}
            {hasDraftRubric === 'yes' && (
              <div className="space-y-3">

                {/* Tabs */}
                <div className="flex border-b border-gray-200">
                  <button
                    onClick={() => setDocUploadTab('local')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 font-bold text-sm transition-all border-b-2 -mb-px ${
                      docUploadTab === 'local'
                        ? 'border-[#0033a0] text-[#0033a0]'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <HardDrive className="w-4 h-4" /> From Local Drive
                  </button>
                  <button
                    onClick={() => setDocUploadTab('google')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 font-bold text-sm transition-all border-b-2 -mb-px ${
                      docUploadTab === 'google'
                        ? 'border-[#0033a0] text-[#0033a0]'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <FolderOpen className="w-4 h-4" /> From Google Drive
                  </button>
                </div>

                {/* From Local Drive tab */}
                {docUploadTab === 'local' && (
                  <>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                        isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/30'
                      }`}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-bold text-gray-700">Drag & drop rubric files here</p>
                      <p className="text-xs text-gray-500 mt-1">or click to browse · .docx / .doc</p>
                    </div>

                    {/* Paste area */}
                    <div
                      ref={pasteAreaRef}
                      tabIndex={0}
                      onFocus={() => setIsPasteAreaFocused(true)}
                      onBlur={() => setIsPasteAreaFocused(false)}
                      onPaste={handlePasteAreaPaste}
                      onClick={() => pasteAreaRef.current?.focus()}
                      className={`w-full px-4 py-3 border-2 rounded-xl flex items-center gap-3 cursor-text transition-all outline-none ${
                        isPasteAreaFocused
                          ? 'border-[#0033a0] bg-blue-50 ring-2 ring-blue-200 ring-offset-1'
                          : 'border-gray-200 bg-gray-50 hover:border-[#0033a0]/40'
                      }`}
                    >
                      <Clipboard className={`w-4 h-4 flex-shrink-0 transition-colors ${isPasteAreaFocused ? 'text-[#0033a0]' : 'text-gray-400'}`} />
                      <span className={`text-sm font-bold transition-colors ${isPasteAreaFocused ? 'text-[#0033a0]' : 'text-gray-500'}`}>
                        {isPasteAreaFocused ? 'Ready — press Ctrl+V (or ⌘+V) to paste' : 'Click here to paste a file'}
                      </span>
                    </div>

                    <button onClick={() => fileInputRef.current?.click()} className="w-full px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2">
                      <Upload className="w-4 h-4" /> Browse Files
                    </button>
                  </>
                )}

                {/* From Google Drive tab */}
                {docUploadTab === 'google' && (
                  <>
                    {/* Signed-in status */}
                    {googleSignedIn && state.googleUser && (
                      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-green-900">{state.googleUser.name}</p>
                            <p className="text-xs text-green-700">{state.googleUser.email}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => signOutGoogle()}
                          className="text-xs font-bold text-gray-500 hover:text-red-600 transition-colors"
                        >
                          Sign Out
                        </button>
                      </div>
                    )}

                    {/* Browse Google Drive button */}
                    <button
                      onClick={handleGooglePicker}
                      disabled={!googleSignedIn}
                      className="w-full py-3 px-4 bg-[#0033a0] text-white rounded-xl font-bold hover:bg-[#002d8f] disabled:bg-gray-200 disabled:text-gray-400 transition-all flex items-center justify-center gap-2"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Browse Google Drive
                    </button>

                    {!googleSignedIn && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-sm font-bold text-gray-700 mb-1">Google sign-in required</p>
                        <p className="text-xs text-gray-600 mb-3">Sign in to pick files directly from your Drive.</p>
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

                    {/* OR divider */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Or Paste a URL</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>

                    {/* Drive URL input */}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1.5">Google Drive URL</label>
                      <input
                        type="url"
                        value={driveUrl}
                        onChange={(e) => { setDriveUrl(e.target.value); setDriveUrlError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleFetchFromDriveUrl(); }}
                        placeholder="docs.google.com/document/d/... or drive.google.com/file/d/..."
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:border-[#0033a0] focus:outline-none transition-all"
                      />
                      {driveUrlError && (
                        <p className="text-xs text-red-600 mt-1">{driveUrlError}</p>
                      )}
                      <p className="text-xs text-blue-700 mt-1.5">
                        Supports Google Docs, Word (.docx), and PDF files stored in Drive.{' '}
                        <span className="text-gray-500">The file must be accessible to your signed-in account.</span>
                      </p>
                      <button
                        onClick={handleFetchFromDriveUrl}
                        disabled={!driveUrl.trim() || isFetchingDriveUrl || !googleSignedIn}
                        className="w-full mt-2 py-2.5 px-4 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400 transition-all text-sm flex items-center justify-center gap-2"
                      >
                        {isFetchingDriveUrl && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isFetchingDriveUrl ? 'Fetching…' : 'Fetch from Drive'}
                      </button>
                    </div>
                  </>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                  multiple
                  className="hidden"
                  onChange={handleFileInput}
                />

                {uploadedFiles.length > 0 && (
                  <div className="space-y-1">
                    {uploadedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm">
                        <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
                        <span className="flex-1 truncate font-medium text-gray-800">{f.name}</span>
                        <button onClick={() => setUploadedFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </SetupCard>
        )}

        {/* ── Target Canvas Course — appears only when "Yes" is selected ── */}
        {coreSetupComplete && hasDraftRubric === 'yes' && (
          <SetupCard isValid={courseUrlValid}>
            <div className="flex items-center gap-2 mb-1">
              <Link className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <h3 className="font-black text-lg text-gray-900">Target Canvas Course</h3>
              {courseUrlValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
            </div>
            <p className="text-sm text-gray-600 mb-3">Enter the homepage URL of the Canvas course you want to deploy rubrics to.</p>
            <input
              type="url"
              value={courseUrlInput}
              onChange={(e) => handleCourseUrlChange(e.target.value)}
              placeholder="https://canvas.institution.edu/courses/12345"
              className={`w-full px-4 py-3 border-2 rounded-xl text-sm focus:outline-none transition-all ${
                courseUrlInput && !courseUrlValid
                  ? 'border-red-300 focus:border-red-400'
                  : courseUrlValid
                  ? 'border-green-400 focus:border-green-500'
                  : 'border-gray-200 focus:border-blue-400'
              }`}
            />
            {courseUrlInput && !courseUrlValid && (
              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                <X className="w-3 h-3" /> URL must include a /courses/&lt;ID&gt; path
              </p>
            )}
            {courseUrlValid && (
              <div className="mt-3 flex items-center gap-2 min-h-[1.5rem]">
                {courseNameLoading ? (
                  <Loader2 className="w-4 h-4 text-green-500 animate-spin" />
                ) : courseName ? (
                  <>
                    <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-green-700">{courseName}</span>
                  </>
                ) : null}
              </div>
            )}
          </SetupCard>
        )}

      </div>

      {/* "Yes" path: Analyze & Deploy button */}
      {hasDraftRubric === 'yes' && !showAnalyze && (
        <div className="mt-6">
          <button
            onClick={() => handleAnalyzeDeploy('yes')}
            disabled={!allRequiredValid}
            className={`w-full py-4 rounded-2xl font-black text-base uppercase tracking-widest transition-all active:scale-95 ${
              allRequiredValid
                ? 'bg-[#0033a0] text-white hover:bg-blue-900 shadow-xl cursor-pointer'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
            }`}
          >
            Analyze Draft Rubric(s) and Deploy To Canvas
          </button>
          {!allRequiredValid && (
            <p className="text-center text-sm text-gray-500 mt-2">
              Button becomes active when form is completely filled out.
            </p>
          )}
        </div>
      )}

      {/* "No" path: Phase 1 selection cards (V.1 style) */}
      {hasDraftRubric === 'no' && (
        <div className="mt-4">
          <div className="bg-blue-50 border-l-4 border-[#2B579A] p-4 rounded-xl">
            <h3 className="text-sm font-black text-[#2B579A] uppercase tracking-widest mb-4">
              Phase 1: Create Phase
            </h3>
            <div className="space-y-1">

              {/* Create Draft Rubric(s) */}
              <button
                onClick={() => setPhase1Mode(phase1Mode === 'rubric' ? 'none' : 'rubric')}
                className={`w-full p-6 rounded-t-2xl border-2 transition-all shadow-md flex items-start gap-6 group text-left ${
                  phase1Mode === 'rubric'
                    ? 'border-[#2B579A] bg-blue-50'
                    : 'border-gray-100 bg-white hover:border-[#2B579A] hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-all">
                    <Lightbulb className="w-6 h-6 text-amber-600" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-600" />
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                    <span className="text-[#2B579A] font-black text-sm">W</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-lg text-gray-900">Create Draft Rubric(s)</h3>
                  <p className="text-sm text-gray-600 mt-2">
                    Transform an assignment description into a matching draft rubric (MS Word / Google Docs file).
                  </p>
                </div>
              </button>

              {/* OR divider */}
              <div className="px-6 py-3 bg-blue-100 border-l-2 border-r-2 border-[#2B579A] flex items-center justify-center">
                <p className="text-sm font-black text-[#2B579A]">or</p>
              </div>

              {/* Screenshot to Editable Doc */}
              <button
                onClick={() => setPhase1Mode(phase1Mode === 'screenshot' ? 'none' : 'screenshot')}
                className={`w-full p-6 rounded-b-2xl border-2 transition-all shadow-md flex items-start gap-6 group text-left ${
                  phase1Mode === 'screenshot'
                    ? 'border-[#2B579A] bg-blue-50'
                    : 'border-gray-100 bg-white hover:border-[#2B579A] hover:bg-white'
                }`}
              >
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-all">
                    <Camera className="w-6 h-6 text-purple-600" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-600" />
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                    <span className="text-[#2B579A] font-black text-sm">W</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-lg text-gray-900">Screenshot to Editable Doc</h3>
                  <p className="text-sm text-gray-600 mt-2">
                    Convert Canvas rubric screenshots to a matching, editable, draft rubric (MS Word / Google Docs file).
                  </p>
                </div>
              </button>

            </div>
          </div>

          {/* Inline Phase 1 content */}
          {phase1Mode === 'rubric' && (
            <div className="mt-4">
              <Part1Rubric
                onAnalyzeDeploy={() => handleAnalyzeDeploy('no')}
                canAnalyzeDeploy={geminiValid && canvasTokenValid}
              />
            </div>
          )}
          {phase1Mode === 'screenshot' && (
            <div className="mt-4">
              <ScreenshotConverter />
            </div>
          )}
        </div>
      )}

      {/* Analyze & Deploy section (expands inline) */}
      {showAnalyze && (
        <div ref={analyzeRef}>
          <AnalyzeDeploySection
            phase1Rubric={analyzeRubricSource === 'no' ? (state.rubric ?? undefined) : undefined}
            uploadedFiles={analyzeRubricSource === 'yes' ? uploadedFiles : undefined}
            courseUrl={courseUrlInput}
            canvasToken={state.canvasApiToken ?? ''}
          />
        </div>
      )}

    </div>
  );
};
