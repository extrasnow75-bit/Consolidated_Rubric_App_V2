import React, { useCallback, useRef, useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import {
  Key, Check, X, Loader2, ExternalLink, Eye, EyeOff,
  LogOut, Link, FileText, Upload, ChevronDown, FolderOpen,
} from 'lucide-react';
import { validateGeminiApiKey } from '../services/geminiService';
import { Part1Rubric } from './Part1Rubric';
import { AnalyzeDeploySection, UploadedDocFile } from './AnalyzeDeploySection';

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
}> = ({ children, isValid, isOptional = false }) => (
  <div
    className={`bg-white rounded-2xl border-2 p-6 shadow-sm transition-all duration-300 ${
      isValid
        ? 'border-green-400 ring-2 ring-green-300 ring-offset-1 shadow-green-100'
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

  // ── Draft Rubric Document ──
  const [hasDraftRubric, setHasDraftRubricLocal] = useState<'' | 'yes' | 'no'>('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedDocFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Analyze & Deploy ──
  const [showAnalyze, setShowAnalyze] = useState(false);
  const [analyzeRubricSource, setAnalyzeRubricSource] = useState<'yes' | 'no' | null>(null);
  const analyzeRef = useRef<HTMLDivElement>(null);

  // ─── Derived validity ────────────────────────────────────────────────────────

  const geminiValid = !!state.geminiApiKey;
  const canvasTokenValid = !!state.canvasApiToken;
  const googleSignedIn = state.isGoogleAuthenticated;
  const draftRubricValid =
    hasDraftRubric === 'yes' ? uploadedFiles.length > 0 : hasDraftRubric === 'no';

  const allRequiredValid = geminiValid && canvasTokenValid && courseUrlValid && draftRubricValid;

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

  const handleGooglePicker = async () => {
    try {
      const result = await openGooglePicker();
      if (!result) return;
      const buffer = await downloadDriveFile(result.id);
      const bytes = new Uint8Array(buffer);
      let binary = '';
      bytes.forEach((b) => (binary += String.fromCharCode(b)));
      const base64 = btoa(binary);
      setUploadedFiles((prev) => {
        if (prev.some((p) => p.name === result.name)) return prev;
        return [
          ...prev,
          {
            name: result.name,
            data: base64,
            mimeType:
              result.mimeType ||
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        ];
      });
    } catch (err: any) {
      console.error('Google Picker error:', err);
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

      {/* Page heading */}
      <div className="text-center mb-8">
        <h2 className="text-3xl font-black text-gray-900">Initial Setup</h2>
        <p className="text-gray-600 mt-2 font-medium">Complete each section, then deploy your rubric(s) to Canvas.</p>
      </div>

      <div className="space-y-4">

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

        {/* Card 2: Google Sign-In (optional) */}
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

        {/* Card 3: Canvas API Token */}
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
                className="w-full px-4 py-3 bg-red-600 text-white rounded-xl font-black hover:bg-red-700 transition-all text-sm disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" /> Save Token
              </button>
            </div>
          )}
        </SetupCard>

        {/* Card 4: Target Canvas Course */}
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
        </SetupCard>

        {/* Card 5: Draft Rubric Document */}
        <SetupCard isValid={draftRubricValid}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <h3 className="font-black text-lg text-gray-900">Draft Rubric Document</h3>
            {draftRubricValid && <Check className="w-4 h-4 text-green-500 ml-auto flex-shrink-0" />}
          </div>
          <p className="text-sm text-gray-600 mb-3">Do you already have a draft rubric document ready to deploy?</p>

          <div className="relative mb-4">
            <select
              value={hasDraftRubric}
              onChange={(e) => handleDraftRubricChange(e.target.value as '' | 'yes' | 'no')}
              className="w-full appearance-none px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-purple-400 focus:outline-none transition-all bg-white font-medium text-gray-700 cursor-pointer"
            >
              <option value="">Select...</option>
              <option value="yes">Yes - I have a draft rubric document</option>
              <option value="no">No - I need to create one first</option>
            </select>
            <ChevronDown className="absolute right-3 top-3.5 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>

          {/* "Yes" path — file upload area */}
          {hasDraftRubric === 'yes' && (
            <div className="space-y-3">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${
                  isDragging ? 'border-purple-400 bg-purple-50' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50/30'
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-700">Drag & drop rubric files here</p>
                <p className="text-xs text-gray-500 mt-1">or click to browse · .docx / .doc</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                multiple
                className="hidden"
                onChange={handleFileInput}
              />

              <div className="flex gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4" /> Browse Files
                </button>
                {googleSignedIn && (
                  <button onClick={handleGooglePicker} className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2">
                    <FolderOpen className="w-4 h-4" /> Google Drive
                  </button>
                )}
              </div>

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

          {/* "No" path — brief note */}
          {hasDraftRubric === 'no' && (
            <p className="text-sm text-blue-700 bg-blue-50 rounded-xl px-4 py-3 font-medium">
              The rubric creator will appear below. Once you've generated your rubric, you'll see the deploy button.
            </p>
          )}
        </SetupCard>

      </div>

      {/* "Yes" path: Analyze & Deploy button */}
      {hasDraftRubric === 'yes' && allRequiredValid && !showAnalyze && (
        <div className="mt-6">
          <button
            onClick={() => handleAnalyzeDeploy('yes')}
            className="w-full py-4 bg-[#0033a0] text-white rounded-2xl font-black text-base uppercase tracking-widest shadow-xl hover:bg-blue-900 transition-all active:scale-95"
          >
            Analyze Draft Rubric(s) and Deploy To Canvas
          </button>
        </div>
      )}

      {/* "No" path: Phase 1 inline */}
      {hasDraftRubric === 'no' && (
        <div className="mt-8 border-t border-gray-200 pt-8">
          <Part1Rubric
            onAnalyzeDeploy={() => handleAnalyzeDeploy('no')}
            canAnalyzeDeploy={geminiValid && canvasTokenValid && courseUrlValid}
          />
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
