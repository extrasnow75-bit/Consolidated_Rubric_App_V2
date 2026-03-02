/** Recently-used Google Drive documents — persisted to localStorage. */

export interface RecentDoc {
  name: string;
  url?: string;       // used when source === 'url'
  fileId?: string;    // used when source === 'picker'
  mimeType?: string;  // used when source === 'picker' to enable re-fetch
  source: 'picker' | 'url';
  timestamp: number;
}

const STORAGE_KEY = 'rubric_app_recent_docs';
const MAX_DOCS = 5;

export function getRecentDocs(): RecentDoc[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as RecentDoc[];
  } catch {
    return [];
  }
}

export function saveRecentDoc(doc: Omit<RecentDoc, 'timestamp'>): void {
  const existing = getRecentDocs();
  // Deduplicate by fileId (picker) or url (manual entry)
  const deduped = existing.filter(d =>
    doc.fileId ? d.fileId !== doc.fileId : d.url !== doc.url
  );
  deduped.unshift({ ...doc, timestamp: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped.slice(0, MAX_DOCS)));
}
