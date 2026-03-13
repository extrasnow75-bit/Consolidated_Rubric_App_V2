/** Recently-used Google Drive documents — persisted to localStorage. */

export interface RecentDoc {
  name: string;
  url?: string;
  fileId?: string;
  mimeType?: string;
  source: 'picker' | 'url';
  timestamp: number;
}

const STORAGE_KEY = 'rubric_app_recent_docs_draft';
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
  const deduped = existing.filter(d =>
    doc.fileId ? d.fileId !== doc.fileId : d.url !== doc.url
  );
  deduped.unshift({ ...doc, timestamp: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped.slice(0, MAX_DOCS)));
}
