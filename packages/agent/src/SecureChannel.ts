import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Security utilities for agent-controller communication.
 * Provides token generation, verification, and hashing.
 */
export class SecureChannel {
  /** Token length in bytes (generates 64-char hex string) */
  private static readonly TOKEN_BYTES = 32;

  /**
   * Generate a random authentication token using crypto.
   * Returns a 64-character hex string.
   */
  static generateToken(): string {
    return randomBytes(SecureChannel.TOKEN_BYTES).toString('hex');
  }

  /**
   * Verify a token against a list of valid tokens using constant-time comparison.
   * Prevents timing attacks by always comparing against all tokens.
   */
  static verifyToken(token: string, validTokens: string[]): boolean {
    if (validTokens.length === 0) {
      return false;
    }

    const tokenBuffer = Buffer.from(token);
    let isValid = false;

    for (const validToken of validTokens) {
      const validBuffer = Buffer.from(validToken);

      // Only do constant-time comparison if lengths match
      if (tokenBuffer.length === validBuffer.length) {
        if (timingSafeEqual(tokenBuffer, validBuffer)) {
          isValid = true;
        }
      }
    }

    return isValid;
  }

  /**
   * Hash a token using SHA-256.
   * Returns the hex-encoded hash.
   */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
