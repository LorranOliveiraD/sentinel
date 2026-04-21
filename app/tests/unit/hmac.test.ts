import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { computeSignature, secureCompare } from '../../src/server/middleware/hmac.js';

const TEST_SECRET = 'test-webhook-secret-12345';

function sign(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(Buffer.from(body));
  return `sha256=${hmac.digest('hex')}`;
}

describe('HMAC Signature Validation', () => {
  describe('computeSignature', () => {
    it('produces sha256= prefixed hex digest', () => {
      const sig = computeSignature(Buffer.from('hello'), TEST_SECRET);
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('matches manual HMAC computation', () => {
      const body = '{"action":"opened"}';
      const expected = sign(body, TEST_SECRET);
      const actual = computeSignature(Buffer.from(body), TEST_SECRET);
      expect(actual).toBe(expected);
    });

    it('produces different signatures for different bodies', () => {
      const sig1 = computeSignature(Buffer.from('body-a'), TEST_SECRET);
      const sig2 = computeSignature(Buffer.from('body-b'), TEST_SECRET);
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different secrets', () => {
      const body = Buffer.from('same-body');
      const sig1 = computeSignature(body, 'secret-1');
      const sig2 = computeSignature(body, 'secret-2');
      expect(sig1).not.toBe(sig2);
    });

    it('handles empty body', () => {
      const sig = computeSignature(Buffer.from(''), TEST_SECRET);
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('handles binary body content', () => {
      const binary = Buffer.from([0x00, 0xff, 0x42, 0x13, 0x37]);
      const sig = computeSignature(binary, TEST_SECRET);
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });
  });

  describe('secureCompare', () => {
    it('returns true for identical strings', () => {
      const sig = sign('test', TEST_SECRET);
      expect(secureCompare(sig, sig)).toBe(true);
    });

    it('returns false for different strings', () => {
      const sig1 = sign('body-a', TEST_SECRET);
      const sig2 = sign('body-b', TEST_SECRET);
      expect(secureCompare(sig1, sig2)).toBe(false);
    });

    it('returns false for different length strings', () => {
      expect(secureCompare('short', 'much-longer-string')).toBe(false);
    });

    it('returns true for matching computed signatures', () => {
      const body = '{"pull_request":{"number":1}}';
      const sig = sign(body, TEST_SECRET);
      const computed = computeSignature(Buffer.from(body), TEST_SECRET);
      expect(secureCompare(sig, computed)).toBe(true);
    });

    it('returns false for tampered signature', () => {
      const body = '{"action":"opened"}';
      const validSig = sign(body, TEST_SECRET);
      const tampered = validSig.slice(0, -1) + (validSig.endsWith('0') ? '1' : '0');
      expect(secureCompare(validSig, tampered)).toBe(false);
    });
  });

  describe('End-to-end validation flow', () => {
    it('validates a properly signed GitHub-style payload', () => {
      const payload = JSON.stringify({
        action: 'opened',
        pull_request: { number: 42, title: 'test PR' },
        repository: { full_name: 'org/repo' },
      });

      const signature = sign(payload, TEST_SECRET);
      const computed = computeSignature(Buffer.from(payload), TEST_SECRET);
      expect(secureCompare(signature, computed)).toBe(true);
    });

    it('rejects payload signed with wrong secret', () => {
      const payload = '{"action":"opened"}';
      const wrongSig = sign(payload, 'wrong-secret');
      const correctSig = computeSignature(Buffer.from(payload), TEST_SECRET);
      expect(secureCompare(wrongSig, correctSig)).toBe(false);
    });

    it('validates payloads with unicode characters correctly', () => {
      const payload = '{"comment":"Ação concluída com sucesso 🚀"}';
      const signature = sign(payload, TEST_SECRET);
      const computed = computeSignature(Buffer.from(payload), TEST_SECRET);
      expect(secureCompare(signature, computed)).toBe(true);
    });
  });
});
