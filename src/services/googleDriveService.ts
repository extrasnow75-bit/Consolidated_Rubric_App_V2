// Google Drive API endpoints
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_EXPORT_API = 'https://www.googleapis.com/drive/v3/files';

export interface PickerResult {
  fileId: string;
  mimeType: string;
  name: string;
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
    return new Promise((resolve, reject) => {
      const gapi = (window as any).gapi;
      if (!gapi) {
        reject(new Error('Google API library is not loaded. Please refresh the page and try again.'));
        return;
      }

      gapi.load('picker', {
        callback: () => {
          const google = (window as any).google;
          if (!google?.picker) {
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

          const view = new google.picker.DocsView()
            .setIncludeFolders(true)
            .setSelectFolderEnabled(false)
            .setMimeTypes(SUPPORTED_MIME_TYPES);

          const builder = new google.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(accessToken)
            .setCallback((data: any) => {
              if (data.action === google.picker.Action.PICKED) {
                const doc = data.docs[0];
                resolve({ fileId: doc.id, mimeType: doc.mimeType, name: doc.name });
              } else if (data.action === google.picker.Action.CANCEL) {
                resolve(null);
              }
            });

          if (this.pickerApiKey) {
            builder.setDeveloperKey(this.pickerApiKey);
          }

          builder.build().setVisible(true);
        },
        onerror: () => {
          reject(new Error('Failed to load Google Picker. Check that the Picker API is enabled in your Google Cloud project.'));
        },
      });
    });
  }

  /**
   * Extract file ID from Google Docs/Sheets URL
   */
  extractFileIdFromUrl(url: string): string {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      return match[1];
    }

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
   * Get Google Docs content as plain text
   */
  async getGoogleDocContent(fileId: string, accessToken: string): Promise<string> {
    try {
      const response = await fetch(
        `${GOOGLE_EXPORT_API}/${fileId}/export?mimeType=text/plain`,
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
    } catch (error: any) {
      if (
        error.message.includes('Document not found') ||
        error.message.includes('You do not have access') ||
        error.message.includes('Google Drive access not authorized') ||
        error.message.includes('session has expired') ||
        error.message.includes('Failed to fetch document')
      ) {
        throw error;
      }
      throw new Error(`Failed to fetch Google Doc: ${error.message}`);
    }
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
