// ============================================
// UNIFIED TYPES FOR CONSOLIDATED RUBRIC APP
// ============================================

// =========================
// ENUMS
// =========================

export enum AppMode {
  DASHBOARD = 'DASHBOARD',
  PART_1 = 'PART_1',
  PART_2 = 'PART_2',
  PART_3 = 'PART_3',
  SCREENSHOT = 'SCREENSHOT'
}

export enum PointStyle {
  RANGE = 'RANGE',
  SINGLE = 'SINGLE'
}

export enum Role {
  USER = 'user',
  MODEL = 'model'
}

export enum BatchItemStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum AppModeForUpload {
  UPLOAD = 'upload',
  SETTINGS = 'settings'
}

export type FileProcessingStatus = 'pending' | 'uploading' | 'success' | 'error';

// =========================
// INTERFACES - RUBRIC DATA
// =========================

export interface RubricRating {
  text: string;
  points: string;
}

export interface RubricCriterion {
  category: string;
  description: string;
  exemplary: RubricRating;
  proficient: RubricRating;
  developing: RubricRating;
  unsatisfactory: RubricRating;
  totalPoints: number;
}

export interface RubricData {
  title: string;
  criteria: RubricCriterion[];
  totalPoints: number;
}

export interface RubricMeta {
  name: string;
  totalPoints: string;
  scoringMethod: 'ranges' | 'fixed';
}

// =========================
// INTERFACES - CANVAS
// =========================

export interface CanvasConfig {
  courseHomeUrl: string;
  accessToken: string;
}

export interface CanvasUser {
  id: number;
  name: string;
}

export interface RubricRatingCanvas {
  description: string;
  long_description: string;
  points: number;
}

export interface RubricCriterionCanvas {
  description: string;
  long_description: string;
  ratings: Record<string, RubricRatingCanvas>;
}

export interface RubricPayload {
  rubric: {
    title: string;
    criteria: Record<string, RubricCriterionCanvas>;
  };
  rubric_association: {
    association_id: string;
    association_type: 'Course' | 'Assignment';
    use_for_grading: boolean;
    purpose: string;
  };
}

// =========================
// INTERFACES - FILE/MESSAGE
// =========================

export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // Base64 string
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  attachments?: Attachment[];
  timestamp: number;
  metadata?: {
    filename?: string;
  };
}

// =========================
// INTERFACES - BATCH/UPLOAD
// =========================

export interface BatchItem extends RubricMeta {
  id: string;
  status: BatchItemStatus;
  csvContent?: string;
  error?: string;
}

export interface BatchStatus {
  fileName: string;
  status: FileProcessingStatus;
  error?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface UploadHistoryItem {
  id: string;
  timestamp: number;
  rubricName: string;
  totalPoints: number;
  csvFileName?: string;
  canvasUploadStatus?: 'pending' | 'success' | 'failed';
  error?: string;
}

// =========================
// INTERFACES - SESSION STATE
// =========================

export interface SessionState {
  // Current step in workflow
  currentStep: AppMode;

  // Rubric data (persists across steps)
  rubric: RubricData | null;
  rubricMetadata: RubricMeta | null;

  // CSV output (from Part 2)
  csvOutput: string | null;
  csvFileName: string | null;

  // Canvas config (for Part 3)
  canvasConfig: CanvasConfig | null;

  // Batch operations
  batchItems: BatchItem[];

  // Session history
  uploadHistory: UploadHistoryItem[];

  // UI state
  isLoading: boolean;
  error: string | null;
  helpOpen: boolean;
}

// =========================
// INTERFACES - GENERATION
// =========================

export interface GenerationSettings {
  totalPoints: number;
  pointStyle: PointStyle;
}

// =========================
// INTERFACES - CANVAS API
// =========================

export interface RubricConfig {
  canvasUrl: string;
  token: string;
  courseId: string;
  useProxy: boolean;
  proxyService: string;
}
