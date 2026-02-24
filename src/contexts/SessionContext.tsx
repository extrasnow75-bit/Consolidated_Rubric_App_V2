import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from 'react';
import {
  SessionState,
  AppMode,
  RubricData,
  RubricMeta,
  CanvasConfig,
  BatchItem,
  UploadHistoryItem,
  ProgressState,
  CachedMetadata,
  ThrottlerMetrics,
} from '../types';
import { onThrottlerMetrics } from '../services/throttlerService';

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
  addToMetadataCache: (fileHash: string, metadata: RubricMeta) => void;
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
    metadataCache: new Map<string, CachedMetadata>(),
    cacheTTL: 1800000, // 30 minutes
    throttlerMetrics: {
      queued: 0,
      processing: false,
      totalRequests: 0,
      failedRequests: 0,
    },
  });

  // Register throttler metrics callback to update UI in real-time
  useEffect(() => {
    const unsubscribe = onThrottlerMetrics((metrics: ThrottlerMetrics) => {
      setState((prev) => ({ ...prev, throttlerMetrics: metrics }));
    });
    // Cleanup is implicit since onThrottlerMetrics returns void
  }, []);

  // Periodic cache cleanup: remove expired entries every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.metadataCache || prev.metadataCache.size === 0) {
          return prev;
        }

        const now = Date.now();
        const cacheTTL = prev.cacheTTL || 1800000;
        const expiredKeys: string[] = [];

        prev.metadataCache.forEach((cached, key) => {
          if (now - cached.timestamp > cacheTTL) {
            expiredKeys.push(key);
          }
        });

        if (expiredKeys.length === 0) {
          return prev;
        }

        const newCache = new Map(prev.metadataCache);
        expiredKeys.forEach((key) => newCache.delete(key));
        console.log(`[Cache] Removed ${expiredKeys.length} expired entries`);

        return { ...prev, metadataCache: newCache };
      });
    }, 60000); // Check every 60 seconds

    return () => clearInterval(interval);
  }, []);

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

    setState({
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
    });
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

  const addToMetadataCache = useCallback((fileHash: string, metadata: RubricMeta) => {
    setState((prev) => {
      if (!prev.metadataCache) {
        return prev;
      }
      const newCache = new Map(prev.metadataCache);
      newCache.set(fileHash, {
        fileHash,
        data: metadata,
        timestamp: Date.now(),
        ttlMs: prev.cacheTTL || 1800000,
      });
      return { ...prev, metadataCache: newCache };
    });
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
    addToMetadataCache,
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
