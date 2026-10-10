import { ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { Message } from '../../../src/ohne/messages/known-messages.ts';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

type LargePlainCatalog = Record<`large.${'a' | 'b'}${Digit}${Digit}${Digit}`, {}>;

type LargeParamCatalog = Record<`large.params${Digit}${Digit}`, { n: number }>;

// Past this size, a union mixing `Message` with another type is too complex for the checker.
declare module 'ohnejs' {
  interface KnownMessages extends LargePlainCatalog, LargeParamCatalog {}
}

describe('Message', () => {
  it('keeps a large catalog type-checkable across the framework', () => {
    const plain: Message = 'large.a123';
    const withParams: Message = { key: 'large.params42', params: { n: 1 } };
    ok([plain, withParams].length === 2);
  });
});
