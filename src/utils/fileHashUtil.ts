/**
 * File Hashing Utility
 *
 * Provides consistent hashing of file content for cache key generation
 * Uses Web Crypto API for strong hashing (SHA-256)
 */

/**
 * Generate SHA-256 hash of file content
 *
 * @param content - File content (string or ArrayBuffer)
 * @returns Promise<string> - Hex-encoded hash
 */
export async function hashFile(content: string | ArrayBuffer): Promise<string> {
  // Convert content to Uint8Array
  let data: Uint8Array;

  if (content instanceof ArrayBuffer) {
    data = new Uint8Array(content);
  } else if (typeof content === 'string') {
    const encoder = new TextEncoder();
    data = encoder.encode(content);
  } else {
    throw new Error('Content must be string or ArrayBuffer');
  }

  try {
    // Use Web Crypto API for SHA-256 hashing
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
  } catch (error) {
    console.error('[FileHash] Error generating hash:', error);
    // Fallback: use simple string-based hash (less reliable but works everywhere)
    return fallbackHash(content instanceof ArrayBuffer ? '[ArrayBuffer]' : content);
  }
}

/**
 * Fallback hashing function (for environments without Web Crypto)
 * Uses a simple algorithm - not cryptographically secure but adequate for cache keys
 */
function fallbackHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Generate a short fingerprint for display/logging
 *
 * @param fullHash - Full SHA-256 hash
 * @returns First 8 characters of hash
 */
export function shortHashFingerprint(fullHash: string): string {
  return fullHash.substring(0, 8);
}
