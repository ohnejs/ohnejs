import { deepStrictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { readStored, writeStored } from '../../../src/utils/storage/stored.ts';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/**
 * Installs `storage` as the global `localStorage` for one test.
 */
function install(storage: Partial<Storage> | undefined): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

describe('readStored and writeStored', () => {
  let items: Map<string, string>;

  beforeEach(() => {
    items = new Map();
    install({
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('round-trips a JSON value', () => {
    writeStored('panels', { left: 300 });
    deepStrictEqual(readStored('panels', { left: 272 }), { left: 300 });
  });

  it('answers the fallback for a missing or malformed value', () => {
    deepStrictEqual(readStored('panels', { left: 272 }), { left: 272 });
    items.set('panels', '{nope');
    deepStrictEqual(readStored('panels', 1), 1);
  });

  it('answers the fallback and writes nothing where storage is blocked or absent', () => {
    install({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    writeStored('panels', 1);
    deepStrictEqual(readStored('panels', 2), 2);
    install(undefined);
    writeStored('panels', 1);
    deepStrictEqual(readStored('panels', 2), 2);
  });
});
