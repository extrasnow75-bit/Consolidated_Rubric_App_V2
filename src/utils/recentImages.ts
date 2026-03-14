/** Recently-used Google Drive images — persisted to localStorage. */

export interface RecentImage {
  name: string;
  url?: string;
  fileId?: string;
  mimeType?: string;
  source: 'picker' | 'url';
  timestamp: number;
}

const STORAGE_KEY = 'rubric_app_recent_images';
const MAX_IMAGES = 5;

export function getRecentImages(): RecentImage[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as RecentImage[];
  } catch {
    return [];
  }
}

export function saveRecentImage(img: Omit<RecentImage, 'timestamp'>): void {
  const existing = getRecentImages();
  const deduped = existing.filter(i =>
    img.fileId ? i.fileId !== img.fileId : i.url !== img.url
  );
  deduped.unshift({ ...img, timestamp: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped.slice(0, MAX_IMAGES)));
}
