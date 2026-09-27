import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type CrossOriginRequest, isCrossOriginWrite } from '../../../src/utils/index.ts';

const SELF = 'http://localhost:9001';
const PAGE = 'http://localhost:3000';

function write(request: Partial<CrossOriginRequest>, trusted: string[] = []): boolean {
  return isCrossOriginWrite(
    { method: 'POST', origin: null, fetchSite: null, self: SELF, ...request },
    trusted,
  );
}

describe('isCrossOriginWrite', () => {
  it('passes a safe method from any origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'TRACE'])
      strictEqual(write({ method, origin: PAGE, fetchSite: 'cross-site' }), false);
  });

  it('passes a same-origin or user-initiated request', () => {
    strictEqual(write({ origin: PAGE, fetchSite: 'same-origin' }), false);
    strictEqual(write({ origin: PAGE, fetchSite: 'none' }), false);
  });

  it('refuses a same-site or cross-site page unless its origin is trusted', () => {
    for (const fetchSite of ['same-site', 'cross-site']) {
      strictEqual(write({ origin: PAGE, fetchSite }), true);
      strictEqual(write({ origin: PAGE, fetchSite }, [PAGE]), false);
      strictEqual(write({ fetchSite }, [PAGE]), true);
    }
  });

  it('falls back to Origin without fetch metadata', () => {
    strictEqual(write({ origin: SELF }), false);
    strictEqual(write({ origin: PAGE }), true);
    strictEqual(write({ origin: PAGE }, [PAGE]), false);
    strictEqual(write({ origin: 'null' }), true);
  });

  it('passes a request with neither header, as a non-browser client sends', () => {
    strictEqual(write({}), false);
  });

  it('checks every unsafe method', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      strictEqual(write({ method, origin: PAGE, fetchSite: 'same-site' }), true);
  });
});
