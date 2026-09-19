import { pdfjsLib } from './pdfWorker';

/**
 * Pull the text out of a PDF, or say clearly why there is none.
 *
 * Five places in Part 1 had this loop copied out — local upload, two Drive routes, and the two
 * "replace my draft" inputs — and every one of them ended with `setAssignmentDescription(text)`
 * whether or not `text` had anything in it.
 *
 * That matters because pdf.js reads a PDF's text layer and does no OCR. A scan, or a photograph
 * of a page, is images: `getTextContent()` returns nothing, the join produces an empty string,
 * and the box was quietly set to it. No text, no error, nothing to explain why — the same shape
 * of silent failure as the .docx bug in v0.9.2 and the dropped PDF in the Dashboard.
 *
 * Throwing rather than returning '' puts the explanation in the callers' existing catch blocks,
 * so none of them can forget to check.
 */
export async function extractPdfText(data: ArrayBuffer, fileName: string): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str).join(' '));
  }

  const text = pages.join('\n\n');
  if (!text.trim()) {
    throw new Error(
      `No text could be read from “${fileName}”. If it is a scan or a photograph of a page, the ` +
        'words are part of an image and cannot be extracted — paste the text in instead, or use a ' +
        'PDF that was exported rather than scanned.',
    );
  }
  return text;
}
