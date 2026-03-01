import React, { useState } from 'react';
import { useSession } from '../contexts/SessionContext';
import { AppMode } from '../types';
import { Lightbulb, FileText, Upload, Camera, ArrowRight, LogOut, Key, Check, X, Loader2, ExternalLink, Trash2, Eye, EyeOff } from 'lucide-react';
import { validateGeminiApiKey } from '../services/geminiService';

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="currentColor"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="currentColor"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="currentColor"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="currentColor"
    />
  </svg>
);

export const Dashboard: React.FC = () => {
  const { state, setCurrentStep, clearSession, startGoogleAuth, signOutGoogle, setUserGeminiApiKey, setUserCanvasApiToken } = useSession();

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [keyValidationResult, setKeyValidationResult] = useState<'idle' | 'valid' | 'invalid'>('idle');

  const [canvasTokenInput, setCanvasTokenInput] = useState('');
  const [showCanvasToken, setShowCanvasToken] = useState(false);

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
    if (!canvasTokenInput.trim()) return;
    setUserCanvasApiToken(canvasTokenInput.trim());
    setCanvasTokenInput('');
  };

  const handleRemoveCanvasToken = () => {
    setUserCanvasApiToken(null);
  };

  const maskApiKey = (key: string) => {
    if (key.length <= 8) return key;
    return key.substring(0, 8) + '...' + key.substring(key.length - 4);
  };

  const handleStartPart = (part: AppMode) => {
    setCurrentStep(part);
  };

  const handleGoogleSignIn = () => {
    startGoogleAuth();
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogle();
  };

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="flex gap-8 w-full max-w-6xl">
        {/* Main Dashboard Card - Left Side */}
        <div className="bg-white p-12 rounded-3xl shadow-2xl border border-gray-100 flex-1">
          {/* Title Section */}
          <div className="mb-8">
            <h2 className="text-3xl font-black text-gray-900 mb-2">Rubric Tools</h2>
            <p className="text-gray-600 font-medium">What would you like me to do for you?</p>
          </div>

        {/* Main Workflow Steps - Vertical Layout with Phases */}
        <div className="space-y-6">
          {/* PHASE 1: CREATE PHASE - Microsoft Word Blue Background */}
          <div className="bg-blue-50 border-l-4 border-[#2B579A] p-4 rounded-lg">
            <h3 className="text-sm font-black text-[#2B579A] uppercase tracking-widest mb-4">Phase 1: Create Phase</h3>
            <div className="space-y-1">
              {/* Part 1: Create Draft Rubric */}
              <button
                onClick={() => handleStartPart(AppMode.PART_1)}
                className="w-full p-6 rounded-t-2xl border-2 border-gray-100 hover:border-[#2B579A] hover:bg-white transition-all shadow-md bg-white flex items-start gap-6 group text-left"
              >
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-all">
                    <Lightbulb className="w-6 h-6 text-amber-600" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                    <div className="text-[#2B579A] font-black text-sm">W</div>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-lg text-gray-900">Create Draft Rubric(s)</h3>
                  <p className="text-sm text-gray-600 mt-2">Transform an assignment description into a matching draft rubric (MS Word / Google Docs file).</p>
                </div>
              </button>

              {/* OR divider */}
              <div className="px-6 py-3 bg-blue-100 border-l-2 border-r-2 border-[#2B579A] flex items-center justify-center">
                <p className="text-sm font-black text-[#2B579A]">or</p>
              </div>

              {/* Screenshot Converter */}
              <button
                onClick={() => handleStartPart(AppMode.SCREENSHOT)}
                className="w-full p-6 rounded-b-2xl border-2 border-gray-100 hover:border-[#2B579A] hover:bg-white transition-all shadow-md bg-white flex items-start gap-6 group text-left"
              >
                <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center group-hover:bg-purple-200 transition-all">
                    <Camera className="w-6 h-6 text-purple-600" />
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                  <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                    <div className="text-[#2B579A] font-black text-sm">W</div>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-lg text-gray-900">Screenshot to Word Template</h3>
                  <p className="text-sm text-gray-600 mt-2">Convert Canvas rubric screenshots to MS Word / Google Docs rubric template.</p>
                </div>
              </button>
            </div>
          </div>

          {/* PHASE 2: CONVERSION PHASE - Excel Green Background */}
          <div className="bg-green-100 border-l-4 border-[#107C10] p-4 rounded-lg">
            <h3 className="text-sm font-black text-[#107C10] uppercase tracking-widest mb-4">Phase 2: Conversion Phase</h3>
            <button
              onClick={() => handleStartPart(AppMode.PART_2)}
              className="w-full p-6 rounded-2xl border-2 border-gray-100 hover:border-[#107C10] hover:bg-white transition-all shadow-md bg-white flex items-start gap-6 group text-left"
            >
              <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-all">
                  <div className="text-[#2B579A] font-black text-sm">W</div>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400" />
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-all">
                  <div className="text-[#107C10] font-black text-[10px]">CSV</div>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="font-black text-lg text-gray-900">Convert draft rubric(s) to CSV(s)</h3>
                <p className="text-sm text-gray-600 mt-2">Transform one or more existing rubrics (MS Word / Google Docs files) into Canvas-compatible CSV files for quick upload.</p>
              </div>
            </button>
          </div>

          {/* PHASE 3: DEPLOYMENT PHASE - Canvas Red Background */}
          <div className="bg-red-100 border-l-4 border-[#E64C3C] p-4 rounded-lg">
            <h3 className="text-sm font-black text-[#E64C3C] uppercase tracking-widest mb-4">Phase 3: Deployment Phase</h3>
            <button
              onClick={() => handleStartPart(AppMode.PART_3)}
              className="w-full p-6 rounded-2xl border-2 border-gray-100 hover:border-[#E64C3C] hover:bg-white transition-all shadow-md bg-white flex items-start gap-6 group text-left"
            >
              <div className="flex items-center gap-2 pt-1 flex-shrink-0">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-all">
                  <div className="text-[#107C10] font-black text-[10px]">CSV</div>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400" />
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-all">
                  <svg viewBox="0 0 100 100" className="w-6 h-6" xmlns="http://www.w3.org/2000/svg">
                    <g fill="#E63027">
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(45, 50, 50)" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(90, 50, 50)" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(135, 50, 50)" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(180, 50, 50)" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(225, 50, 50)" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(270, 50, 50)" />
                      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(315, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(22.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(67.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(112.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(157.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(202.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(247.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(292.5, 50, 50)" />
                      <circle cx="50" cy="28" r="5" transform="rotate(337.5, 50, 50)" />
                    </g>
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="font-black text-lg text-gray-900">Upload to Canvas</h3>
                <p className="text-sm text-gray-600 mt-2">Automatically upload one or more rubrics (CSV files) to a Canvas course at once.</p>
                <p className="text-xs text-gray-600 mt-1 italic">*Requires a Canvas Token</p>
                <p className="text-xs text-gray-600 mt-1 italic">Click the Help Center button to learn how to generate a token or how to complete this step manually.</p>
              </div>
            </button>
          </div>
        </div>

        {/* Session History */}
        {state.uploadHistory.length > 0 && (
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h3 className="font-black text-sm text-gray-700 uppercase tracking-widest mb-4">Recent Activity</h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {state.uploadHistory.slice(0, 5).map((item) => (
                <div key={item.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs">
                  <p className="font-bold text-gray-900">{item.rubricName}</p>
                  <p className="text-gray-600">{item.totalPoints} points • {new Date(item.timestamp).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clear Session Button */}
        <div className="mt-8 pt-8 border-t border-gray-200 flex justify-between">
          <p className="text-xs text-gray-500 flex items-center">
            {state.uploadHistory.length > 0 && `${state.uploadHistory.length} items in history`}
          </p>
          {state.uploadHistory.length > 0 && (
            <button
              onClick={clearSession}
              className="text-xs font-bold text-red-600 hover:text-red-700 uppercase tracking-widest hover:underline"
            >
              Clear Session
            </button>
          )}
        </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-80 flex-shrink-0">

          {/* 1. Gemini API Key Card */}
          <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100">
            <div className="flex items-center gap-2 mb-1">
              <Key className="w-4 h-4 text-amber-600" />
              <h3 className="font-black text-lg text-gray-900">Gemini API Key</h3>
            </div>

            {state.geminiApiKey ? (
              /* Key is saved — show active state */
              <div>
                <div className="flex items-center gap-2 mt-3 mb-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-bold text-green-700">API key active</span>
                </div>
                <p className="text-xs text-gray-500 font-mono mb-4 break-all">
                  {maskApiKey(state.geminiApiKey)}
                </p>
                <button
                  onClick={handleRemoveApiKey}
                  className="w-full px-4 py-2 bg-red-50 text-red-600 rounded-lg font-bold hover:bg-red-100 transition-all text-sm flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove Key
                </button>
              </div>
            ) : (
              /* No key saved — show input */
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Enter your free Google Gemini API key to use the necessary AI features in this app.
                </p>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value);
                    setKeyValidationResult('idle');
                  }}
                  placeholder="Paste your API key here..."
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono focus:border-amber-400 focus:outline-none transition-all mb-3"
                />

                {/* Validation feedback */}
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
                  {isValidatingKey ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Save Key
                    </>
                  )}
                </button>

                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 mt-3 text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline"
                >
                  Get a free key at aistudio.google.com
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* 2. Google Sign-In Box */}
          <div className="mt-4">
            {!state.isGoogleAuthenticated ? (
              <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100">
                <h3 className="font-black text-lg text-gray-900 mb-1">Optional</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Log in to integrate Google Docs and Sheets in the process. Otherwise, just use downloaded MS Word and CSV files.
                </p>
                <button
                  onClick={handleGoogleSignIn}
                  className="w-full px-6 py-3 bg-white border-2 border-blue-400 text-blue-600 rounded-xl font-black hover:bg-blue-50 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <GoogleIcon />
                  Sign In
                </button>
              </div>
            ) : (
              <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100">
                <div className="text-center">
                  {state.googleUser?.picture && (
                    <img
                      src={state.googleUser.picture}
                      alt="Profile"
                      className="w-16 h-16 rounded-full mx-auto mb-3 border-2 border-green-200"
                    />
                  )}
                  <h3 className="font-black text-gray-900">{state.googleUser?.name}</h3>
                  <p className="text-sm text-gray-600 mb-4 break-all">{state.googleUser?.email}</p>
                  <div className="flex items-center justify-center mb-4 text-green-600">
                    <div className="w-2 h-2 bg-green-600 rounded-full mr-2"></div>
                    <span className="text-xs font-bold">Signed In</span>
                  </div>
                  <button
                    onClick={handleGoogleSignOut}
                    className="w-full px-4 py-2 bg-red-100 text-red-700 rounded-lg font-bold hover:bg-red-200 transition-all text-sm"
                  >
                    <LogOut className="w-4 h-4 inline mr-2" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3. Canvas API Token Card */}
          <div className="bg-white p-8 rounded-3xl shadow-2xl border border-gray-100 mt-4">
            <div className="flex items-center gap-2 mb-1">
              <Key className="w-4 h-4 text-red-600" />
              <h3 className="font-black text-lg text-gray-900">Canvas API Token</h3>
            </div>

            {state.canvasApiToken ? (
              /* Token is saved — show active state */
              <div>
                <div className="flex items-center gap-2 mt-3 mb-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-bold text-green-700">Token saved</span>
                </div>
                <p className="text-xs text-gray-500 font-mono mb-4 break-all">
                  {maskApiKey(state.canvasApiToken)}
                </p>
                <button
                  onClick={handleRemoveCanvasToken}
                  className="w-full px-4 py-2 bg-red-50 text-red-600 rounded-lg font-bold hover:bg-red-100 transition-all text-sm flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove Token
                </button>
              </div>
            ) : (
              /* No token saved — show input */
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Only required for Phase 3. You can enter it here now or directly in Phase 3 later.
                </p>
                <div className="relative mb-3">
                  <input
                    type={showCanvasToken ? 'text' : 'password'}
                    value={canvasTokenInput}
                    onChange={(e) => setCanvasTokenInput(e.target.value)}
                    placeholder="Paste your Canvas token here..."
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-mono focus:border-red-400 focus:outline-none transition-all pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCanvasToken((v) => !v)}
                    className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"
                  >
                    {showCanvasToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={handleSaveCanvasToken}
                  disabled={!canvasTokenInput.trim()}
                  className="w-full px-4 py-3 bg-red-600 text-white rounded-xl font-black hover:bg-red-700 transition-all text-sm disabled:bg-gray-200 disabled:text-gray-400 flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Save Token
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
