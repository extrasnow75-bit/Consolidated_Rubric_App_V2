import React, { createContext, useContext, useState, useCallback, ReactNode, useRef, useEffect } from 'react';
import {
  SessionState,
  AppMode,
  RubricData,
  RubricMeta,
  CanvasConfig,
  BatchItem,
  UploadHistoryItem,
  ProgressState,
  GoogleUser,
} from '../types';
import { googleDriveService, PickerResult } from '../services/googleDriveService';
import { setGeminiApiKey as geminiServiceSetApiKey } from '../services/geminiService';
import {
  initiateGoogleSignIn,
  handleGoogleRedirectResult,
  signOutFromGoogle,
  getStoredAccessToken,
  onAuthStateChanged,
} from '../services/firebaseService';

// Create context
const SessionContext = createContext<{
  state: SessionState;
  setCurrentStep: (step: AppMode) => void;
  setRubric: (rubric: RubricData | null) => void;
  setRubricMetadata: (metadata: RubricMeta | null) => void;
  setCsvOutput: (csv: string | null, fileName?: string) => void;
  setCanvasConfig: (config: CanvasConfig | null) => void;
  addBatchItem: (item: BatchItem) => void;
  updateBatchItem: (id: string, updates: Partial<BatchItem>) => void;
  removeBatchItem: (id: string) => void;
  addToHistory: (item: UploadHistoryItem) => void;
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setTaskCompletionOpen: (open: boolean) => void;
  setProgress: (progress: Partial<ProgressState>) => void;
  startProgress: (totalItems?: number, canCancel?: boolean) => void;
  stopProgress: () => void;
  requestCancel: () => void;
  getAbortSignal: () => AbortSignal;
  clearSession: () => void;
  newBatch: () => void;
  // Gemini API Key
  setUserGeminiApiKey: (key: string | null) => void;
  // Canvas API Token
  setUserCanvasApiToken: (token: string | null) => void;
  // Google Auth methods
  startGoogleAuth: () => Promise<void>;
  signOutGoogle: () => Promise<void>;
  extractGoogleDocText: (docUrl: string) => Promise<string>;
  extractGoogleSheetCsv: (sheetUrl: string) => Promise<string>;
  downloadDriveFile: (fileId: string) => Promise<ArrayBuffer>;
  openGooglePicker: () => Promise<PickerResult | null>;
} | undefined>(undefined);

// Provider component
export const SessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const abortControllerRef = useRef<AbortController | null>(null);
  const progressStartTimeRef = useRef<number>(0);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<SessionState>({
    currentStep: AppMode.DASHBOARD,
    rubric: null,
    rubricMetadata: null,
    csvOutput: null,
    csvFileName: null,
    canvasConfig: null,
    batchItems: [],
    uploadHistory: [],
    isLoading: false,
    error: null,
    helpOpen: false,
    taskCompletionOpen: false,
    progress: {
      isProcessing: false,
      percentage: 0,
      currentStep: '',
      timeElapsed: 0,
      timeRemaining: 0,
      bytesProcessed: 0,
      totalBytes: 0,
      itemsProcessed: 0,
      totalItems: 0,
      canCancel: false,
    },
    // Gemini API Key
    geminiApiKey: null,
    // Canvas API Token
    canvasApiToken: null,
    // Google Authentication
    isGoogleAuthenticated: false,
    googleUser: null,
    googleAccessToken: null,
    googleRefreshToken: null,
    googleTokenExpiresAt: null,
    googleAuthError: null,
    isAuthenticating: false,
  });

  const setCurrentStep = useCallback((step: AppMode) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const setRubric = useCallback((rubric: RubricData | null) => {
    setState((prev) => ({ ...prev, rubric }));
  }, []);

  const setRubricMetadata = useCallback((metadata: RubricMeta | null) => {
    setState((prev) => ({ ...prev, rubricMetadata: metadata }));
  }, []);

  const setCsvOutput = useCallback((csv: string | null, fileName?: string) => {
    setState((prev) => ({
      ...prev,
      csvOutput: csv,
      csvFileName: fileName || prev.csvFileName,
    }));
  }, []);

  const setCanvasConfig = useCallback((config: CanvasConfig | null) => {
    setState((prev) => ({ ...prev, canvasConfig: config }));
  }, []);

  const addBatchItem = useCallback((item: BatchItem) => {
    setState((prev) => ({
      ...prev,
      batchItems: [...prev.batchItems, item],
    }));
  }, []);

  const updateBatchItem = useCallback((id: string, updates: Partial<BatchItem>) => {
    setState((prev) => ({
      ...prev,
      batchItems: prev.batchItems.map((item) =>
        item.id === id ? { ...item, ...updates } : item
      ),
    }));
  }, []);

  const removeBatchItem = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      batchItems: prev.batchItems.filter((item) => item.id !== id),
    }));
  }, []);

  const addToHistory = useCallback((item: UploadHistoryItem) => {
    setState((prev) => ({
      ...prev,
      uploadHistory: [item, ...prev.uploadHistory],
    }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setIsLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, isLoading: loading }));
  }, []);

  const setHelpOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, helpOpen: open }));
  }, []);

  const setTaskCompletionOpen = useCallback((open: boolean) => {
    setState((prev) => ({ ...prev, taskCompletionOpen: open }));
  }, []);

  const setProgress = useCallback((progress: Partial<ProgressState>) => {
    setState((prev) => ({
      ...prev,
      progress: { ...prev.progress, ...progress },
    }));
  }, []);

  const startProgress = useCallback((totalItems: number = 1, canCancel: boolean = true) => {
    abortControllerRef.current = new AbortController();
    progressStartTimeRef.current = Date.now();

    setState((prev) => ({
      ...prev,
      progress: {
        isProcessing: true,
        percentage: 0,
        currentStep: 'Starting...',
        timeElapsed: 0,
        timeRemaining: 0,
        bytesProcessed: 0,
        totalBytes: 0,
        itemsProcessed: 0,
        totalItems,
        canCancel,
      },
    }));

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(() => {
      setState((prev) => {
        const elapsed = Date.now() - progressStartTimeRef.current;
        const percentageDecimal = prev.progress.percentage > 0
          ? prev.progress.percentage
          : (prev.progress.totalItems > 0
              ? prev.progress.itemsProcessed / prev.progress.totalItems
              : 0);
        const estimatedTotal = percentageDecimal > 0 ? elapsed / percentageDecimal : 0;
        const remaining = Math.max(0, estimatedTotal - elapsed);

        return {
          ...prev,
          progress: {
            ...prev.progress,
            timeElapsed: elapsed,
            timeRemaining: remaining,
          },
        };
      });
    }, 100);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      progress: {
        ...prev.progress,
        isProcessing: false,
      },
    }));
  }, []);

  const requestCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const getAbortSignal = useCallback((): AbortSignal => {
    if (!abortControllerRef.current) {
      abortControllerRef.current = new AbortController();
    }
    return abortControllerRef.current.signal;
  }, []);

  const clearSession = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setState((prev) => ({
      currentStep: AppMode.DASHBOARD,
      rubric: null,
      rubricMetadata: null,
      csvOutput: null,
      csvFileName: null,
      canvasConfig: null,
      batchItems: [],
      uploadHistory: [],
      isLoading: false,
      error: null,
      helpOpen: false,
      taskCompletionOpen: false,
      progress: {
        isProcessing: false,
        percentage: 0,
        currentStep: '',
        timeElapsed: 0,
        timeRemaining: 0,
        bytesProcessed: 0,
        totalBytes: 0,
        itemsProcessed: 0,
        totalItems: 0,
        canCancel: false,
      },
      // Preserve Gemini API key, Canvas token, and Google auth across session clears
      geminiApiKey: prev.geminiApiKey,
      canvasApiToken: prev.canvasApiToken,
      isGoogleAuthenticated: prev.isGoogleAuthenticated,
      googleUser: prev.googleUser,
      googleAccessToken: prev.googleAccessToken,
      googleRefreshToken: null,
      googleTokenExpiresAt: prev.googleTokenExpiresAt,
      googleAuthError: null,
      isAuthenticating: false,
    }));
  }, []);

  const newBatch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      rubric: null,
      rubricMetadata: null,
      csvOutput: null,
      csvFileName: null,
      batchItems: [],
      error: null,
      isLoading: false,
    }));
  }, []);

  // Gemini API Key management
  const setUserGeminiApiKey = useCallback((key: string | null) => {
    setState((prev) => ({ ...prev, geminiApiKey: key }));
    if (key) {
      localStorage.setItem('gemini_api_key', key);
      geminiServiceSetApiKey(key);
    } else {
      localStorage.removeItem('gemini_api_key');
      geminiServiceSetApiKey('');
    }
  }, []);

  // Canvas API Token management
  const setUserCanvasApiToken = useCallback((token: string | null) => {
    setState((prev) => ({ ...prev, canvasApiToken: token }));
    if (token) {
      localStorage.setItem('canvas_api_token', token);
    } else {
      localStorage.removeItem('canvas_api_token');
    }
  }, []);

  // ── Google Auth (Firebase redirect flow) ───────────────────────────────────

  const startGoogleAuth = useCallback(async () => {
    // Show brief "Redirecting..." feedback before the page navigates away
    setState((prev) => ({ ...prev, isAuthenticating: true, googleAuthError: null }));
    try {
      await initiateGoogleSignIn(); // page navigates to Google; never resolves normally
    } catch (err: any) {
      // User cancelled the popup — don't treat as error
      const isCancelled = err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/cancelled-popup-request';
      setState((prev) => ({
        ...prev,
        isAuthenticating: false,
        googleAuthError: err.message || 'Sign-in failed',
      }));
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    try {
      await signOutFromGoogle();
    } catch (err: any) {
      console.error('Sign out error:', err);
    } finally {
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: false,
        googleUser: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
        googleAuthError: null,
      }));
    }
  }, []);

  const extractGoogleDocText = useCallback(
    async (docUrl: string): Promise<string> => {
      if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
        throw new Error('Please sign in with Google first');
      }
      const fileId = googleDriveService.extractFileIdFromUrl(docUrl);
      return googleDriveService.getGoogleDocContent(fileId, state.googleAccessToken);
    },
    [state.isGoogleAuthenticated, state.googleAccessToken]
  );

  const extractGoogleSheetCsv = useCallback(
    async (sheetUrl: string): Promise<string> => {
      if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
        throw new Error('Please sign in with Google first');
      }
      const fileId = googleDriveService.extractFileIdFromUrl(sheetUrl);
      return googleDriveService.getGoogleSheetContent(fileId, state.googleAccessToken);
    },
    [state.isGoogleAuthenticated, state.googleAccessToken]
  );

  const downloadDriveFile = useCallback(
    async (fileId: string): Promise<ArrayBuffer> => {
      if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
        throw new Error('Please sign in with Google first');
      }
      return googleDriveService.downloadFileAsArrayBuffer(fileId, state.googleAccessToken);
    },
    [state.isGoogleAuthenticated, state.googleAccessToken]
  );

  const openGooglePicker = useCallback(
    async (): Promise<PickerResult | null> => {
      if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
        throw new Error('Please sign in with Google first');
      }
      return googleDriveService.openPicker(state.googleAccessToken);
    },
    [state.isGoogleAuthenticated, state.googleAccessToken]
  );

  // ── Initialization ─────────────────────────────────────────────────────────

  useEffect(() => {
    // Restore saved Gemini API key
    const savedApiKey = localStorage.getItem('gemini_api_key');
    if (savedApiKey) {
      setState((prev) => ({ ...prev, geminiApiKey: savedApiKey }));
      geminiServiceSetApiKey(savedApiKey);
    }

    // Restore saved Canvas API token
    const savedCanvasToken = localStorage.getItem('canvas_api_token');
    if (savedCanvasToken) {
      setState((prev) => ({ ...prev, canvasApiToken: savedCanvasToken }));
    }

    // Handle the result if the user just returned from a Google redirect sign-in.
    handleGoogleRedirectResult()
      .then((result) => {
        if (result) {
          setState((prev) => ({
            ...prev,
            isGoogleAuthenticated: true,
            googleUser: result.user,
            googleAccessToken: result.accessToken,
            googleRefreshToken: null,
            googleTokenExpiresAt: result.expiresAt,
            googleAuthError: null,
            isAuthenticating: false,
          }));
        }
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          isAuthenticating: false,
          googleAuthError: err.message || 'Sign-in failed',
        }));
      });

    // Listen for Firebase auth state changes.
    // When the page reloads, Firebase restores the user from IndexedDB.
    // If a valid Google access token is also in sessionStorage we restore
    // the full authenticated state silently; otherwise the user needs to
    // sign in again.
    const unsubscribe = onAuthStateChanged((firebaseUser) => {
      if (firebaseUser) {
        const stored = getStoredAccessToken();
        if (stored) {
          const googleUser: GoogleUser = {
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: firebaseUser.displayName || firebaseUser.email || 'Google User',
            picture: firebaseUser.photoURL || undefined,
          };
          setState((prev) => ({
            ...prev,
            isGoogleAuthenticated: true,
            googleUser,
            googleAccessToken: stored.accessToken,
            googleTokenExpiresAt: stored.expiresAt,
          }));
        } else {
          // Firebase user exists but Drive access token has expired.
          // Clear auth so the UI prompts the user to sign in again.
          setState((prev) => ({
            ...prev,
            isGoogleAuthenticated: false,
            googleUser: null,
            googleAccessToken: null,
            googleTokenExpiresAt: null,
          }));
        }
      } else {
        setState((prev) => ({
          ...prev,
          isGoogleAuthenticated: false,
          googleUser: null,
          googleAccessToken: null,
          googleTokenExpiresAt: null,
        }));
      }
    });

    return () => unsubscribe();
  }, []);

  const value = {
    state,
    setCurrentStep,
    setRubric,
    setRubricMetadata,
    setCsvOutput,
    setCanvasConfig,
    addBatchItem,
    updateBatchItem,
    removeBatchItem,
    addToHistory,
    setError,
    setIsLoading,
    setHelpOpen,
    setTaskCompletionOpen,
    setProgress,
    startProgress,
    stopProgress,
    requestCancel,
    getAbortSignal,
    clearSession,
    newBatch,
    setUserGeminiApiKey,
    setUserCanvasApiToken,
    startGoogleAuth,
    signOutGoogle,
    extractGoogleDocText,
    extractGoogleSheetCsv,
    downloadDriveFile,
    openGooglePicker,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

// Hook to use the session context
export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
