// Google Drive API endpoints
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_EXPORT_API = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DOCS_API = 'https://docs.googleapis.com/v1/documents';

export interface PickerResult {
  fileId: string;
  mimeType: string;
  name: string;
}

export interface FolderPickerResult {
  folderId: string;
  folderName: string;
}

export interface UploadResult {
  fileId: string;
  webViewLink: string;
}

export interface GoogleUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

class GoogleDriveService {
  private pickerApiKey: string;

  constructor() {
    this.pickerApiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY || '';
  }

  /**
   * Open the Google Picker dialog to let the user browse their Drive.
   * @param accessToken  OAuth access token for the signed-in user.
   * @param mimeTypes    Optional list of MIME types to show.  Defaults to
   *                     Google Docs, Word (.docx), PDF, and plain text.
   *                     Pass e.g. ['application/vnd.google-apps.spreadsheet']
   *                     to restrict to Google Sheets.
   */
  openPicker(accessToken: string, mimeTypes?: string[]): Promise<PickerResult | null> {
    // Fast-fail with a clear message if the API key is missing — avoids
    // the unescapable Google 403 overlay that appears without a developer key.
    if (!this.pickerApiKey) {
      return Promise.reject(new Error(
        'Google Drive Picker API key is not configured. ' +
        'Please add VITE_GOOGLE_PICKER_API_KEY to your Vercel environment variables and redeploy.'
      ));
    }

    return new Promise((resolve, reject) => {
      // Safety timeout: if the picker never calls back (e.g. blocked by a
      // 403 error overlay), reject after 60 s so callers can clean up state.
      const timeoutId = setTimeout(() => {
        reject(new Error(
          'Google Drive Picker timed out. ' +
          'This usually means the Picker API is not enabled in your Google Cloud project, ' +
          'or the API key is restricted. Please refresh and try again.'
        ));
      }, 10_000);

      const gapi = (window as any).gapi;
      if (!gapi) {
        clearTimeout(timeoutId);
        reject(new Error('Google API library is not loaded. Please refresh the page and try again.'));
        return;
      }

      gapi.load('picker', {
        callback: () => {
          const google = (window as any).google;
          if (!google?.picker) {
            clearTimeout(timeoutId);
            reject(new Error('Google Picker failed to load. Please refresh and try again.'));
            return;
          }

          const DEFAULT_MIME_TYPES = [
            'application/vnd.google-apps.document',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf',
            'text/plain',
          ];
          const SUPPORTED_MIME_TYPES = (mimeTypes ?? DEFAULT_MIME_TYPES).join(',');

          const myDriveView = new google.picker.DocsView()
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setMimeTypes(SUPPORTED_MIME_TYPES);

          const sharedWithMeView = new google.picker.DocsView()
            .setOwnedByMe(false)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setMimeTypes(SUPPORTED_MIME_TYPES);

          const recentView = new google.picker.View(google.picker.ViewId.RECENTLY_PICKED);

          const builder = new google.picker.PickerBuilder()
            .addView(recentView)
            .addView(myDriveView)
            .addView(sharedWithMeView)
            .setOAuthToken(accessToken)
            .setDeveloperKey(this.pickerApiKey)
            .setAppId(this.pickerApiKey.split(':')[0] ?? '')
            .setOrigin(window.location.protocol + '//' + window.location.host)
            .setCallback((data: any) => {
              if (data.action === google.picker.Action.PICKED) {
                clearTimeout(timeoutId);
                const doc = data.docs[0];
                resolve({ fileId: doc.id, mimeType: doc.mimeType, name: doc.name });
              } else if (data.action === google.picker.Action.CANCEL) {
                clearTimeout(timeoutId);
                resolve(null);
              }
            });

          builder.build().setVisible(true);
        },
        onerror: () => {
          clearTimeout(timeoutId);
          reject(new Error('Failed to load Google Picker. Check that the Picker API is enabled in your Google Cloud project.'));
        },
      });
    });
  }

  /**
   * Extract file ID from Google Docs/Sheets URL
   */
  extractFileIdFromUrl(url: string): string {
    // /d/{fileId} — Google Docs, Drive file/folder share links
    const slashMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (slashMatch) return slashMatch[1];

    // ?id={fileId} or &id={fileId} — drive.google.com/open?id=...
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (idMatch) return idMatch[1];

    // Raw file ID
    if (/^[a-zA-Z0-9-_]+$/.test(url)) {
      return url;
    }

    throw new Error(
      'Invalid Google Docs/Sheets URL format. Please use a shareable link (docs.google.com/document/d/... or docs.google.com/spreadsheets/d/...)'
    );
  }

  /**
   * Parse a Google API error response body for a useful message
   */
  private async parseGoogleErrorBody(response: Response): Promise<string> {
    try {
      const body = await response.clone().json();
      const err = body?.error;
      if (!err) return '';
      const reason = err?.errors?.[0]?.reason || '';
      const message = err?.message || '';
      return reason ? `${reason}: ${message}` : message;
    } catch {
      try {
        return await response.clone().text();
      } catch {
        return '';
      }
    }
  }

  /**
   * Recursively extract plain text from a Google Docs API body content array.
   * Handles paragraphs (including text runs) and tables.
   */
  private extractTextFromDocContent(content: any[]): string {
    let text = '';
    for (const element of content || []) {
      if (element.paragraph) {
        for (const el of element.paragraph.elements || []) {
          if (el.textRun?.content) {
            text += el.textRun.content;
          }
        }
      } else if (element.table) {
        for (const row of element.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            text += this.extractTextFromDocContent(cell.content || []);
          }
        }
      }
    }
    return text;
  }

  /**
   * Recursively collect text from a tab and all its child tabs.
   * Returns an array of { title, text } objects, one per tab.
   */
  private collectTabTexts(tab: any, parentTitle?: string): Array<{ title: string; text: string }> {
    const rawTitle: string = tab.tabProperties?.title || `Tab ${(tab.tabProperties?.index ?? 0) + 1}`;
    const title = parentTitle ? `${parentTitle} > ${rawTitle}` : rawTitle;
    const content: any[] = tab.documentTab?.body?.content || [];
    const text = this.extractTextFromDocContent(content);

    const results: Array<{ title: string; text: string }> = [{ title, text }];

    for (const child of tab.childTabs || []) {
      results.push(...this.collectTabTexts(child, title));
    }

    return results;
  }

  /**
   * Get Google Docs content as plain text, supporting documents with multiple tabs.
   * Uses the Drive export API (www.googleapis.com) to export the document as
   * plain text. This avoids the separate docs.googleapis.com domain entirely
   * and works for both single-body and multi-tab Google Docs.
   */
  async getGoogleDocContent(fileId: string, accessToken: string): Promise<string> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}/${fileId}/export?mimeType=text/plain`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (response.status === 404) {
      throw new Error('Document not found. Please check the link and try again.');
    }

    if (response.status === 401) {
      throw new Error('Your Google session has expired. Please sign out and sign in again.');
    }

    if (response.status === 403) {
      const detail = await this.parseGoogleErrorBody(response);
      const isPermissionError = detail.toLowerCase().includes('insufficientpermissions') ||
        detail.toLowerCase().includes('insufficient permissions') ||
        detail.toLowerCase().includes('request had insufficient authentication scopes');
      if (isPermissionError) {
        throw new Error(
          'Google Drive access not authorized. Your current sign-in does not include Drive read permission. ' +
          'Please sign out from the Google panel and sign in again — on the Google consent screen, make sure to allow Drive access.'
        );
      }
      throw new Error(
        'You do not have access to this document. ' +
        (detail ? `(${detail}) ` : '') +
        'Please ensure the document is shared with your Google account.'
      );
    }

    if (!response.ok) {
      const detail = await this.parseGoogleErrorBody(response);
      throw new Error(`Failed to fetch document (HTTP ${response.status}${detail ? `: ${detail}` : ''})`);
    }

    return await response.text();
  }

  /**
   * Download a non-Google-native file (DOCX, PDF, TXT) as raw bytes.
   */
  async downloadFileAsArrayBuffer(fileId: string, accessToken: string): Promise<ArrayBuffer> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (response.status === 401) {
      throw new Error('Your Google session has expired. Please sign out and sign in again.');
    }

    if (response.status === 403) {
      const detail = await this.parseGoogleErrorBody(response);
      const isPermissionError = detail.toLowerCase().includes('insufficientpermissions') ||
        detail.toLowerCase().includes('insufficient permissions') ||
        detail.toLowerCase().includes('request had insufficient authentication scopes');
      if (isPermissionError) {
        throw new Error(
          'Google Drive access not authorized. Please sign out and sign in again, ' +
          'making sure to allow Drive access on the Google consent screen.'
        );
      }
      throw new Error(
        'You do not have access to this file. ' +
        (detail ? `(${detail}) ` : '') +
        'Please ensure the file is shared with your Google account.'
      );
    }

    if (!response.ok) {
      const detail = await this.parseGoogleErrorBody(response);
      throw new Error(`Failed to download file (HTTP ${response.status}${detail ? `: ${detail}` : ''})`);
    }

    return await response.arrayBuffer();
  }

  /**
   * Get Google Sheets content as CSV
   */
  async getGoogleSheetContent(fileId: string, accessToken: string): Promise<string> {
    try {
      const response = await fetch(
        `${GOOGLE_EXPORT_API}/${fileId}/export?mimeType=text/csv`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.status === 404) {
        throw new Error('Sheet not found. Please check the link and try again.');
      }

      if (response.status === 401) {
        throw new Error('Your Google session has expired. Please sign out and sign in again.');
      }

      if (response.status === 403) {
        const detail = await this.parseGoogleErrorBody(response);
        const isPermissionError = detail.toLowerCase().includes('insufficientpermissions') ||
          detail.toLowerCase().includes('insufficient permissions') ||
          detail.toLowerCase().includes('request had insufficient authentication scopes');
        if (isPermissionError) {
          throw new Error(
            'Google Drive access not authorized. Your current sign-in does not include Drive read permission. ' +
            'Please sign out from the Google panel and sign in again — on the Google consent screen, make sure to allow Drive access.'
          );
        }
        throw new Error(
          'You do not have access to this sheet. ' +
          (detail ? `(${detail}) ` : '') +
          'Please ensure the sheet is shared with your Google account.'
        );
      }

      if (!response.ok) {
        const detail = await this.parseGoogleErrorBody(response);
        throw new Error(`Failed to fetch sheet (HTTP ${response.status}${detail ? `: ${detail}` : ''})`);
      }

      return await response.text();
    } catch (error: any) {
      if (
        error.message.includes('Sheet not found') ||
        error.message.includes('You do not have access') ||
        error.message.includes('Google Drive access not authorized') ||
        error.message.includes('session has expired') ||
        error.message.includes('Failed to fetch sheet')
      ) {
        throw error;
      }
      throw new Error(`Failed to fetch Google Sheet: ${error.message}`);
    }
  }

  /**
   * Open a folder-only Google Picker so the user can choose a save destination.
   * Returns the selected folder's ID and name, or null if cancelled.
   */
  openFolderPicker(accessToken: string): Promise<FolderPickerResult | null> {
    if (!this.pickerApiKey) {
      return Promise.reject(new Error(
        'Google Drive Picker API key is not configured. ' +
        'Please add VITE_GOOGLE_PICKER_API_KEY to your Vercel environment variables and redeploy.'
      ));
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(
          'Google Drive folder picker timed out. ' +
          'This may be caused by a domain authorization issue — please ensure the app domain is listed as an ' +
          'authorized JavaScript origin for the Picker API key in Google Cloud Console, then refresh and try again.'
        ));
      }, 10_000);

      const gapi = (window as any).gapi;
      if (!gapi) {
        clearTimeout(timeoutId);
        reject(new Error('Google API library is not loaded. Please refresh the page and try again.'));
        return;
      }

      gapi.load('picker', {
        callback: () => {
          try {
            const google = (window as any).google;
            if (!google?.picker) {
              clearTimeout(timeoutId);
              reject(new Error('Google Picker failed to load. Please refresh and try again.'));
              return;
            }

            const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
              .setSelectFolderEnabled(true)
              .setMimeTypes('application/vnd.google-apps.folder');

            const builder = new google.picker.PickerBuilder()
              .addView(view)
              .setOAuthToken(accessToken)
              .setDeveloperKey(this.pickerApiKey)
              .setOrigin(window.location.protocol + '//' + window.location.host)
              .setTitle('Choose a folder to save to')
              .setCallback((data: any) => {
                if (data.action === google.picker.Action.PICKED) {
                  clearTimeout(timeoutId);
                  const doc = data.docs[0];
                  resolve({ folderId: doc.id, folderName: doc.name });
                } else if (data.action === google.picker.Action.CANCEL) {
                  clearTimeout(timeoutId);
                  resolve(null);
                } else if (data.action === 'error') {
                  clearTimeout(timeoutId);
                  reject(new Error('Google Picker encountered an error. Please try again.'));
                }
              });

            builder.build().setVisible(true);
          } catch (err: any) {
            clearTimeout(timeoutId);
            reject(new Error(`Google Drive Picker failed to open: ${err?.message || 'Unknown error'}`));
          }
        },
        onerror: () => {
          clearTimeout(timeoutId);
          reject(new Error('Failed to load Google Picker. Check that the Picker API is enabled in your Google Cloud project.'));
        },
      });
    });
  }

  /**
   * Upload a text/CSV string to Google Drive, optionally converting it to a
   * native Google format (Doc or Sheet).
   *
   * @param accessToken    OAuth access token.
   * @param content        UTF-8 string content to upload.
   * @param filename       Name for the file (without extension).
   * @param sourceMimeType MIME type of the content, e.g. 'text/plain' or 'text/csv'.
   * @param targetMimeType Google MIME type to convert to, e.g.
   *                       'application/vnd.google-apps.document' or
   *                       'application/vnd.google-apps.spreadsheet'.
   * @param folderId       Optional parent folder ID. Defaults to My Drive root.
   */
  async uploadFileToDrive(
    accessToken: string,
    content: string,
    filename: string,
    sourceMimeType: string,
    targetMimeType: string,
    folderId?: string,
  ): Promise<UploadResult> {
    const metadata: Record<string, any> = {
      name: filename,
      mimeType: targetMimeType,
    };
    if (folderId) {
      metadata.parents = [folderId];
    }

    const metadataPart = JSON.stringify(metadata);
    const boundary = '-------314159265358979323846';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadataPart,
      `--${boundary}`,
      `Content-Type: ${sourceMimeType}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
        },
        body,
      }
    );

    if (response.status === 401) {
      throw new Error('Your Google session has expired. Please sign out and sign in again.');
    }
    if (response.status === 403) {
      const detail = await this.parseGoogleErrorBody(response);
      throw new Error(
        'Google Drive upload failed — insufficient permissions. ' +
        'Please sign out and sign in again, making sure to allow Drive access.' +
        (detail ? ` (${detail})` : '')
      );
    }
    if (!response.ok) {
      const detail = await this.parseGoogleErrorBody(response);
      throw new Error(`Failed to upload to Google Drive (HTTP ${response.status}${detail ? `: ${detail}` : ''})`);
    }

    return await response.json() as UploadResult;
  }

  /**
   * Verify file access and get metadata
   */
  async verifyFileAccess(
    fileId: string,
    accessToken: string
  ): Promise<{ name: string; mimeType: string }> {
    try {
      const response = await fetch(
        `${GOOGLE_DRIVE_API}/${fileId}?fields=name,mimeType`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (response.status === 404) {
        throw new Error('File not found.');
      }

      if (response.status === 403) {
        throw new Error('You do not have access to this file.');
      }

      if (!response.ok) {
        throw new Error(`Failed to verify access (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(`Access verification failed: ${error.message}`);
    }
  }
}

// Export singleton instance
export const googleDriveService = new GoogleDriveService();
