/**
 * Global Request Throttler Service
 *
 * Manages Gemini API requests to prevent rate limiting:
 * - Maintains FIFO queue of pending requests
 * - Enforces max 1 concurrent request at a time
 * - Enforces minimum interval (3-4s) between sequential requests
 * - Provides metrics: queue depth, wait times, success/failure counts
 * - Auto-cleanup of completed requests
 */

export interface ThrottlerConfig {
  minDelayMs?: number; // Minimum delay between requests (default: 3500ms)
  maxQueueSize?: number; // Max pending requests before warning (default: 50)
  requestTimeoutMs?: number; // Timeout per request (default: 120000ms = 2 min)
}

export interface ThrottlerMetrics {
  queued: number; // Number of requests waiting in queue
  processing: boolean; // Whether a request is currently processing
  lastRequestTime?: number; // Timestamp of last completed request
  totalRequests: number; // Total requests processed
  failedRequests: number; // Total failed requests
  averageWaitMs?: number; // Average wait time in queue
}

interface QueueItem<T> {
  id: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
}

// Global state for throttler
let requestQueue: QueueItem<any>[] = [];
let isProcessing = false;
let lastRequestTime = 0;
let totalRequests = 0;
let failedRequests = 0;
let metricsCallback: ((metrics: ThrottlerMetrics) => void) | null = null;

// Configuration with sensible defaults
const DEFAULT_CONFIG: Required<ThrottlerConfig> = {
  minDelayMs: 3500,
  maxQueueSize: 50,
  requestTimeoutMs: 120000,
};

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Set throttler configuration
 */
export function setThrottlerConfig(config: Partial<ThrottlerConfig>): void {
  currentConfig = { ...currentConfig, ...config };
  console.log(`[Throttler] Config updated:`, currentConfig);
}

/**
 * Get current throttler configuration
 */
export function getThrottlerConfig(): Required<ThrottlerConfig> {
  return currentConfig;
}

/**
 * Register a callback for metrics updates
 */
export function onThrottlerMetrics(callback: (metrics: ThrottlerMetrics) => void): void {
  metricsCallback = callback;
}

/**
 * Get current throttler metrics
 */
export function getThrottlerMetrics(): ThrottlerMetrics {
  const now = Date.now();
  const waitTimes = requestQueue.map((item) => now - item.enqueuedAt);
  const averageWaitMs = waitTimes.length > 0
    ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
    : undefined;

  return {
    queued: requestQueue.length,
    processing: isProcessing,
    lastRequestTime,
    totalRequests,
    failedRequests,
    averageWaitMs,
  };
}

/**
 * Emit metrics update if callback registered
 */
function emitMetrics(): void {
  if (metricsCallback) {
    metricsCallback(getThrottlerMetrics());
  }
}

/**
 * Process the next request in queue
 */
async function processNextRequest(): Promise<void> {
  if (isProcessing || requestQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const item = requestQueue.shift();

  if (!item) {
    isProcessing = false;
    return;
  }

  try {
    // Enforce minimum delay between sequential requests
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    const delayNeeded = Math.max(0, currentConfig.minDelayMs - timeSinceLastRequest);

    if (delayNeeded > 0) {
      console.log(`[Throttler] Waiting ${delayNeeded}ms before next request...`);
      await new Promise((resolve) => setTimeout(resolve, delayNeeded));
    }

    // Execute the request with timeout
    const requestPromise = item.fn();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Request timeout after ${currentConfig.requestTimeoutMs}ms`)),
        currentConfig.requestTimeoutMs
      )
    );

    try {
      const result = await Promise.race([requestPromise, timeoutPromise]);
      lastRequestTime = Date.now();
      totalRequests++;
      item.resolve(result);
      console.log(`[Throttler] Request ${item.id} completed successfully`);
    } catch (error) {
      failedRequests++;
      item.reject(error);
      console.error(`[Throttler] Request ${item.id} failed:`, error);
    }
  } finally {
    isProcessing = false;
    emitMetrics();

    // Process next request if any are queued
    if (requestQueue.length > 0) {
      // Use setImmediate to avoid blocking, or setTimeout for better browser support
      setTimeout(() => processNextRequest(), 0);
    }
  }
}

/**
 * Throttle a Gemini API request through the global queue
 *
 * @param requestId - Unique identifier for this request (for logging)
 * @param fn - The async function to execute
 * @param options - Optional throttler config for this request
 * @returns Promise that resolves/rejects based on fn execution
 */
export function throttleGeminiRequest<T>(
  requestId: string,
  fn: () => Promise<T>,
  options?: Partial<ThrottlerConfig>
): Promise<T> {
  return new Promise((resolve, reject) => {
    // Warn if queue is getting large
    if (requestQueue.length >= currentConfig.maxQueueSize) {
      console.warn(
        `[Throttler] Queue is getting large (${requestQueue.length}/${currentConfig.maxQueueSize}). ` +
        `Consider implementing request cancellation or rate limiting on the UI.`
      );
    }

    // Apply request-specific config if provided
    const config = options ? { ...currentConfig, ...options } : currentConfig;

    const queueItem: QueueItem<T> = {
      id: requestId,
      fn,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    };

    requestQueue.push(queueItem);
    console.log(
      `[Throttler] Request ${requestId} queued. Queue depth: ${requestQueue.length}`
    );

    emitMetrics();

    // Kickstart processing if not already running
    processNextRequest().catch((error) => {
      console.error(`[Throttler] Unexpected error in processNextRequest:`, error);
    });
  });
}

/**
 * Clear all pending requests from the queue
 * Useful for cleanup on session clear
 */
export function clearThrottlerQueue(): void {
  const count = requestQueue.length;
  requestQueue = [];
  isProcessing = false;
  console.log(`[Throttler] Queue cleared. Removed ${count} pending requests.`);
  emitMetrics();
}

/**
 * Reset throttler statistics
 */
export function resetThrottlerStats(): void {
  totalRequests = 0;
  failedRequests = 0;
  lastRequestTime = 0;
  console.log(`[Throttler] Statistics reset.`);
  emitMetrics();
}

/**
 * Get throttler status summary (useful for debugging)
 */
export function getThrottlerStatus(): string {
  const metrics = getThrottlerMetrics();
  return (
    `Throttler Status:\n` +
    `  Queue: ${metrics.queued} pending\n` +
    `  Processing: ${metrics.processing ? 'YES' : 'NO'}\n` +
    `  Total: ${metrics.totalRequests} requests processed\n` +
    `  Failed: ${metrics.failedRequests} requests\n` +
    `  Avg Wait: ${metrics.averageWaitMs ?? 0}ms\n` +
    `  Config: ${JSON.stringify(currentConfig, null, 2)}`
  );
}
