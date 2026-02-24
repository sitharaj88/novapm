import { describe, it, expect } from 'vitest';

// No mocks needed -- SecureChannel uses real crypto which is fine for unit tests.
import { SecureChannel } from '../SecureChannel.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecureChannel', () => {
  // ---- Token generation ---------------------------------------------------

  describe('generateToken', () => {
    it('should generate a 64-character hex string', () => {
      const token = SecureChannel.generateToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should generate unique tokens on successive calls', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(SecureChannel.generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  // ---- Token verification -------------------------------------------------

  describe('verifyToken', () => {
    it('should return true for a valid token', () => {
      const token = SecureChannel.generateToken();
      expect(SecureChannel.verifyToken(token, [token])).toBe(true);
    });

    it('should return true when token is in a list of valid tokens', () => {
      const token1 = SecureChannel.generateToken();
      const token2 = SecureChannel.generateToken();
      const token3 = SecureChannel.generateToken();

      expect(SecureChannel.verifyToken(token2, [token1, token2, token3])).toBe(true);
    });

    it('should return false for an invalid token', () => {
      const token = SecureChannel.generateToken();
      const otherToken = SecureChannel.generateToken();
      expect(SecureChannel.verifyToken(token, [otherToken])).toBe(false);
    });

    it('should return false for an empty valid tokens list', () => {
      const token = SecureChannel.generateToken();
      expect(SecureChannel.verifyToken(token, [])).toBe(false);
    });

    it('should return false for a token with different length', () => {
      const shortToken = 'abc123';
      const validToken = SecureChannel.generateToken();
      expect(SecureChannel.verifyToken(shortToken, [validToken])).toBe(false);
    });

    it('should be constant-time (always checks all tokens)', () => {
      // We cannot directly measure timing, but we verify behavior:
      // even if the first token matches, the function should still work correctly.
      const token = SecureChannel.generateToken();
      const other1 = SecureChannel.generateToken();
      const other2 = SecureChannel.generateToken();

      // Token in the middle
      expect(SecureChannel.verifyToken(token, [other1, token, other2])).toBe(true);
      // Token at the start
      expect(SecureChannel.verifyToken(token, [token, other1, other2])).toBe(true);
      // Token at the end
      expect(SecureChannel.verifyToken(token, [other1, other2, token])).toBe(true);
    });

    it('should handle plain string tokens', () => {
      expect(SecureChannel.verifyToken('hello-world', ['hello-world'])).toBe(true);
      expect(SecureChannel.verifyToken('hello-world', ['goodbye-world'])).toBe(false);
    });

    it('should not match partial tokens', () => {
      const token = SecureChannel.generateToken();
      const partial = token.substring(0, 32);
      expect(SecureChannel.verifyToken(partial, [token])).toBe(false);
    });
  });

  // ---- Token hashing ------------------------------------------------------

  describe('hashToken', () => {
    it('should return a SHA-256 hex hash (64 characters)', () => {
      const token = SecureChannel.generateToken();
      const hash = SecureChannel.hashToken(token);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce deterministic hashes', () => {
      const token = 'deterministic-test-token';
      const hash1 = SecureChannel.hashToken(token);
      const hash2 = SecureChannel.hashToken(token);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different tokens', () => {
      const hash1 = SecureChannel.hashToken('token-a');
      const hash2 = SecureChannel.hashToken('token-b');

      expect(hash1).not.toBe(hash2);
    });

    it('should hash the known SHA-256 of an empty string', () => {
      const hash = SecureChannel.hashToken('');
      // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should produce a hash different from the original token', () => {
      const token = SecureChannel.generateToken();
      const hash = SecureChannel.hashToken(token);
      // Both are 64-char hex strings, but they should differ
      expect(hash).not.toBe(token);
    });
  });

  // ---- Invalid key / edge case handling -----------------------------------

  describe('invalid key handling', () => {
    it('should handle empty string token in verifyToken', () => {
      expect(SecureChannel.verifyToken('', [''])).toBe(true);
      expect(SecureChannel.verifyToken('', ['non-empty'])).toBe(false);
    });

    it('should handle Unicode tokens', () => {
      const unicodeToken = '\u{1F600}\u{1F601}\u{1F602}';
      expect(SecureChannel.verifyToken(unicodeToken, [unicodeToken])).toBe(true);
      expect(SecureChannel.verifyToken(unicodeToken, ['different'])).toBe(false);
    });

    it('should handle very long tokens', () => {
      const longToken = 'a'.repeat(10_000);
      expect(SecureChannel.verifyToken(longToken, [longToken])).toBe(true);

      const hash = SecureChannel.hashToken(longToken);
      expect(hash).toHaveLength(64);
    });

    it('should handle tokens with special characters', () => {
      const specialToken = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./~`';
      expect(SecureChannel.verifyToken(specialToken, [specialToken])).toBe(true);
    });
  });
});
