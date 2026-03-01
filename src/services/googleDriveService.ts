import { sha256 } from 'js-sha256';

// Types for Google OAuth
export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

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

interface PKCEPair {
  codeChallenge: string;
  codeVerifier: string;
  state: string;
  createdAt: number;
}

// OAuth configuration keys for sessionStorage
const PKCE_KEY = 'google_oauth_pkce';
const TOKEN_KEY = 'google_oauth_tokens';
const USER_KEY = 'google_oauth_user';

// OAuth endpoints
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

// Google Drive API endpoints
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_EXPORT_API = 'https://www.googleapis.com/drive/v3/files';

class GoogleDriveService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private scopes: string[];
  private pickerApiKey: string;

  constructor() {
    this.clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '';
    this.clientSecret = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_SECRET || '';
    this.redirectUri = import.meta.env.VITE_GOOGLE_OAUTH_REDIRECT_URI || '';
    this.scopes = (import.meta.env.VITE_GOOGLE_OAUTH_SCOPES || '').split(' ');
    this.pickerApiKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY || '';

    if (!this.clientId || !this.redirectUri) {
      console.warn('Google OAuth configuration missing. Check VITE_GOOGLE_OAUTH_CLIENT_ID and VITE_GOOGLE_OAUTH_REDIRECT_URI');
    }
  }

  /**
   * Generate PKCE code pair
   */
  private generatePKCE(): { codeChallenge: string; codeVerifier: string } {
    // Generate random 128-character string for code_verifier
    const codeVerifier = this.generateRandomString(128);

    // Create code_challenge by SHA256 hashing the verifier and base64url encoding
    const hash = sha256.array(codeVerifier);
    const codeChallenge = this.base64UrlEncode(new Uint8Array(hash));

    return { codeChallenge, codeVerifier };
  }

  /**
   * Generate random string of specified length
   */
  private generateRandomString(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const values = new Uint8Array(length);
    crypto.getRandomValues(values);
    for (let i = 0; i < length; i++) {
      result += charset[values[i] % charset.length];
    }
    return result;
  }

  /**
   * Base64url encode
   */
  private base64UrlEncode(buffer: Buffer | Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Initiate OAuth flow
   */
  startOAuthFlow(): void {
    if (!this.clientId || !this.redirectUri) {
      throw new Error('Google OAuth not configured. Check environment variables.');
    }

    // Generate PKCE pair
    const { codeChallenge, codeVerifier } = this.generatePKCE();
    const state = this.generateRandomString(32);

    // Store PKCE and state in sessionStorage (will be validated on callback)
    const pkceData: PKCEPair = {
      codeChallenge,
      codeVerifier,
      state,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(PKCE_KEY, JSON.stringify(pkceData));

    // Build authorization URL
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline', // Request refresh token
      prompt: 'consent', // Force consent screen to ensure refresh token
    });

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
    window.location.href = authUrl;
  }

  /**
   * Handle OAuth callback (extract code from URL)
   */
  async handleOAuthCallback(code: string, state: string): Promise<{ tokens: GoogleAuthTokens; user: GoogleUser }> {
    // Validate state (CSRF protection)
    const pkceData = sessionStorage.getItem(PKCE_KEY);
    if (!pkceData) {
      throw new Error('OAuth session not found. Please sign in again.');
    }

    const pkce = JSON.parse(pkceData) as PKCEPair;

    // Check state matches
    if (pkce.state !== state) {
      throw new Error('OAuth state mismatch. Request may have been intercepted.');
    }

    // Check PKCE not expired (10 minute limit)
    if (Date.now() - pkce.createdAt > 10 * 60 * 1000) {
      sessionStorage.removeItem(PKCE_KEY);
      throw new Error('OAuth session expired. Please sign in again.');
    }

    // Remove PKCE state from storage immediately after all checks pass.
    // This prevents a replay attack where a second visit to the same callback
    // URL (e.g., via browser back/restore) re-uses the already-consumed state.
    // The code_verifier is already captured in `pkce` (local variable) so
    // removing the sessionStorage entry here is safe.
    sessionStorage.removeItem(PKCE_KEY);

    // Exchange code for tokens
    try {
      const tokens = await this.exchangeCodeForTokens(code, pkce.codeVerifier);

      // Fetch user info
      const user = await this.fetchUserInfo(tokens.accessToken);

      // Store tokens and user info
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
      sessionStorage.setItem(USER_KEY, JSON.stringify(user));

      return { tokens, user };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<GoogleAuthTokens & { grantedScopes?: string }> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
    }

    const data = await response.json();

    // Log granted scopes for diagnostic purposes
    if (data.scope) {
      const grantedScopes = data.scope as string;
      const hasDriveReadonly = grantedScopes.includes('drive.readonly') || grantedScopes.includes('https://www.googleapis.com/auth/drive.readonly');
      const hasDriveFile = grantedScopes.includes('drive.file') || grantedScopes.includes('https://www.googleapis.com/auth/drive.file');
      if (!hasDriveReadonly && !hasDriveFile) {
        console.warn('Google OAuth: No Drive scope was granted. Document fetching will not work.');
      } else if (!hasDriveReadonly && hasDriveFile) {
        console.warn('Google OAuth: Only drive.file scope granted (not drive.readonly). Only app-created files can be accessed. Files shared from other accounts will not be accessible.');
      }
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt: Date.now() + (data.expires_in * 1000),
      grantedScopes: data.scope || '',
    };
  }

  /**
   * Fetch user info using access token
   */
  private async fetchUserInfo(accessToken: string): Promise<GoogleUser> {
    const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    const data = await response.json();

    return {
      id: data.sub,
      email: data.email,
      name: data.name,
      picture: data.picture,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
  }

  /**
   * Check if access token is expired (with 5-minute buffer)
   */
  isTokenExpired(expiresAt: number): boolean {
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return Date.now() > expiresAt - bufferMs;
  }

  /**
   * Sign out and revoke tokens
   */
  async signOut(): Promise<void> {
    // Best effort token revocation before clearing (may fail due to CORS)
    const tokensJson = sessionStorage.getItem(TOKEN_KEY);
    if (tokensJson) {
      try {
        const tokens = JSON.parse(tokensJson) as GoogleAuthTokens;
        // Note: Direct revocation may fail due to CORS, but token will expire naturally
        await fetch(`https://oauth2.googleapis.com/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            token: tokens.accessToken,
          }).toString(),
        }).catch(() => {
          // Ignore CORS errors, token will expire anyway
        });
      } catch (e) {
        // Ignore parsing errors
      }
    }

    // Clear storage after revocation attempt
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(PKCE_KEY);
  }

  /**
   * Open the Google Picker dialog to let the user browse their Drive.
   * Resolves with the selected file's info, or null if the user cancels.
   * Requires the Google API script (apis.google.com/js/api.js) to be loaded.
   */
  openPicker(accessToken: string): Promise<PickerResult | null> {
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

          const SUPPORTED_MIME_TYPES = [
            'application/vnd.google-apps.document',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/pdf',
            'text/plain',
          ].join(',');

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
    // Try to match /d/{fileId} pattern
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      return match[1];
    }

    // Try to match as standalone file ID
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
      // Export document as plain text
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
   * Use this for files that can't be exported via the export API.
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
      // Export sheet as CSV
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

  /**
   * Get stored tokens from sessionStorage
   */
  getStoredTokens(): GoogleAuthTokens | null {
    const json = sessionStorage.getItem(TOKEN_KEY);
    if (!json) return null;
    try {
      return JSON.parse(json) as GoogleAuthTokens;
    } catch {
      return null;
    }
  }

  /**
   * Get stored user info from sessionStorage
   */
  getStoredUser(): GoogleUser | null {
    const json = sessionStorage.getItem(USER_KEY);
    if (!json) return null;
    try {
      return JSON.parse(json) as GoogleUser;
    } catch {
      return null;
    }
  }

  /**
   * Update stored tokens
   */
  updateStoredTokens(tokens: GoogleAuthTokens): void {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  }
}

// Export singleton instance
export const googleDriveService = new GoogleDriveService();
