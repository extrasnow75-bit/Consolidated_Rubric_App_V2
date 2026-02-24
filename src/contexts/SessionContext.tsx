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
  GoogleAuthTokens,
} from '../types';
import { googleDriveService } from '../services/googleDriveService';
import { setGeminiApiKey as geminiServiceSetApiKey } from '../services/geminiService';

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
  // Google Auth methods
  startGoogleAuth: () => void;
  completeGoogleAuth: (code: string, state: string) => Promise<void>;
  signOutGoogle: () => Promise<void>;
  refreshGoogleToken: () => Promise<void>;
  extractGoogleDocText: (docUrl: string) => Promise<string>;
  extractGoogleSheetCsv: (sheetUrl: string) => Promise<string>;
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

    // Update elapsed time every 100ms
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(() => {
      setState((prev) => {
        const elapsed = Date.now() - progressStartTimeRef.current;
        const percentageDecimal = prev.progress.totalItems > 0
          ? prev.progress.itemsProcessed / prev.progress.totalItems
          : 0;
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
      // Preserve Gemini API key and Google auth across session clears
      geminiApiKey: prev.geminiApiKey,
      isGoogleAuthenticated: prev.isGoogleAuthenticated,
      googleUser: prev.googleUser,
      googleAccessToken: prev.googleAccessToken,
      googleRefreshToken: prev.googleRefreshToken,
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

  // Google Auth callbacks
  const startGoogleAuth = useCallback(() => {
    setState((prev) => ({ ...prev, isAuthenticating: true }));
    try {
      googleDriveService.startOAuthFlow();
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isAuthenticating: false,
        googleAuthError: err.message,
      }));
    }
  }, []);

  const completeGoogleAuth = useCallback(async (code: string, state: string) => {
    try {
      const { tokens, user } = await googleDriveService.handleOAuthCallback(code, state);
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: true,
        googleUser: user,
        googleAccessToken: tokens.accessToken,
        googleRefreshToken: tokens.refreshToken,
        googleTokenExpiresAt: tokens.expiresAt,
        googleAuthError: null,
        isAuthenticating: false,
      }));
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isAuthenticating: false,
        googleAuthError: err.message,
      }));
      throw err;
    }
  }, []);

  const signOutGoogle = useCallback(async () => {
    try {
      await googleDriveService.signOut();
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: false,
        googleUser: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
        googleAuthError: null,
      }));
    } catch (err: any) {
      console.error('Sign out error:', err);
      // Still clear auth state even if revocation fails
      setState((prev) => ({
        ...prev,
        isGoogleAuthenticated: false,
        googleUser: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
      }));
    }
  }, []);

  const refreshGoogleToken = useCallback(async () => {
    try {
      const tokens = googleDriveService.getStoredTokens();
      if (!tokens || !tokens.refreshToken) {
        return; // No tokens to refresh
      }

      if (!googleDriveService.isTokenExpired(tokens.expiresAt)) {
        return; // Token still valid
      }

      const { accessToken, expiresAt } = await googleDriveService.refreshAccessToken(tokens.refreshToken);
      googleDriveService.updateStoredTokens({
        accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt,
      });

      setState((prev) => ({
        ...prev,
        googleAccessToken: accessToken,
        googleTokenExpiresAt: expiresAt,
      }));
    } catch (err: any) {
      // If refresh fails, clear auth
      await signOutGoogle();
    }
  }, [signOutGoogle]);

  const extractGoogleDocText = useCallback(
    async (docUrl: string): Promise<string> => {
      if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
        throw new Error('Please sign in with Google first');
      }

      try {
        const fileId = googleDriveService.extractFileIdFromUrl(docUrl);
        const text = await googleDriveService.getGoogleDocContent(fileId, state.googleAccessToken);
        return text;
      } catch (err: any) {
        throw err;
      }
    },
    [state.isGoogleAuthenticated, state.googleAccessToken]
  );

  const extractGoogleSheetCsv = useCallback(
    async (sheetUrl: string): Promise<string> => {
      if (!state.isGoogleAuthenticated || !state.googleAccessToken) {
        throw new Error('Please sign in with Google first');
      }

      try {
        const fileId = googleDriveService.extractFileIdFromUrl(sheetUrl);
        const csv = await googleDriveService.getGoogleSheetContent(fileId, state.googleAccessToken);
        return csv;
      } catch (err: any) {
        throw err;
      }
    },
    [state.isGoogleAuthenticated, state.googleAccessToken]
  );

  // Initialize on app load
  useEffect(() => {
    // Restore saved Gemini API key from localStorage
    const savedApiKey = localStorage.getItem('gemini_api_key');
    if (savedApiKey) {
      setState((prev) => ({ ...prev, geminiApiKey: savedApiKey }));
      geminiServiceSetApiKey(savedApiKey);
    }

    const initializeAuth = async () => {
      const storedTokens = googleDriveService.getStoredTokens();
      const storedUser = googleDriveService.getStoredUser();

      if (storedTokens && storedUser) {
        // Check if tokens are expired
        if (googleDriveService.isTokenExpired(storedTokens.expiresAt)) {
          // Try to refresh
          try {
            const { accessToken, expiresAt } = await googleDriveService.refreshAccessToken(
              storedTokens.refreshToken
            );
            googleDriveService.updateStoredTokens({
              accessToken,
              refreshToken: storedTokens.refreshToken,
              expiresAt,
            });

            setState((prev) => ({
              ...prev,
              isGoogleAuthenticated: true,
              googleUser: storedUser,
              googleAccessToken: accessToken,
              googleRefreshToken: storedTokens.refreshToken,
              googleTokenExpiresAt: expiresAt,
            }));
          } catch (err) {
            // Refresh failed, clear auth
            await googleDriveService.signOut();
          }
        } else {
          // Tokens still valid
          setState((prev) => ({
            ...prev,
            isGoogleAuthenticated: true,
            googleUser: storedUser,
            googleAccessToken: storedTokens.accessToken,
            googleRefreshToken: storedTokens.refreshToken,
            googleTokenExpiresAt: storedTokens.expiresAt,
          }));
        }
      }
    };

    initializeAuth();
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
    // Gemini API Key
    setUserGeminiApiKey,
    // Google Auth
    startGoogleAuth,
    completeGoogleAuth,
    signOutGoogle,
    refreshGoogleToken,
    extractGoogleDocText,
    extractGoogleSheetCsv,
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
