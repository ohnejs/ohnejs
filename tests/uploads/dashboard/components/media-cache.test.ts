import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UploadRecord } from '../../../../src/uploads/uploads/types.ts';

import { createMediaCache } from '../../../../src/uploads/dashboard/components/media-cache.ts';
import { effect } from '../../../../src/utils/index.ts';

function upload(uuid: string): UploadRecord {
  return {
    UUID: uuid,
    kind: 'file',
    directory: '',
    name: `${uuid}.png`,
    type: 'image/png',
    size: 1,
    hash: null,
    width: null,
    height: null,
    description: null,
    focalX: null,
    focalY: null,
    author: null,
    uploadedAt: 0,
    _updatedAt: 0,
    path: `${uuid}.png`,
    url: `/uploads/${uuid}.png`,
  };
}

interface Loader {
  calls: string[][];
  load(uuids: readonly string[]): Promise<readonly UploadRecord[] | undefined>;
}

function loader(answer: (uuids: readonly string[]) => readonly UploadRecord[] | undefined): Loader {
  const calls: string[][] = [];
  return {
    calls,
    load: (uuids) => {
      calls.push([...uuids]);
      return Promise.resolve(answer(uuids));
    },
  };
}

const known = (uuids: readonly string[]): UploadRecord[] => uuids.map(upload);

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('createMediaCache', () => {
  it('coalesces reads within one microtask into one request', async () => {
    const backend = loader(known);
    const cache = createMediaCache(backend.load);
    strictEqual(cache.get('a'), undefined);
    strictEqual(cache.get('b'), undefined);
    strictEqual(cache.get('a'), undefined);
    await settle();
    deepStrictEqual(backend.calls, [['a', 'b']]);
    strictEqual(cache.get('a')?.UUID, 'a');
    strictEqual(cache.get('b')?.UUID, 'b');
  });

  it('never asks twice for a record already in flight', async () => {
    const backend = loader(known);
    const cache = createMediaCache(backend.load);
    const first = cache.load(['a']);
    await Promise.resolve();
    const second = cache.load(['a', 'b']);
    await Promise.all([first, second]);
    deepStrictEqual(backend.calls, [['a'], ['b']]);
  });

  it('resolves a load in the asked order, with null for a record the server lacks', async () => {
    const backend = loader((uuids) => known(uuids.filter((uuid) => uuid !== 'gone')));
    const cache = createMediaCache(backend.load);
    const records = await cache.load(['b', 'gone', 'a']);
    deepStrictEqual(
      records.map((record) => record?.UUID ?? record),
      ['b', null, 'a'],
    );
    strictEqual(cache.get('gone'), null);
  });

  it('serves a seeded record without a request and drops its pending fetch', async () => {
    const backend = loader(known);
    const cache = createMediaCache(backend.load);
    strictEqual(cache.get('a'), undefined);
    cache.seed(upload('a'));
    strictEqual(cache.get('a')?.UUID, 'a');
    await settle();
    deepStrictEqual(backend.calls, []);
  });

  it('never subscribes the reactive region that calls load', async () => {
    const backend = loader(known);
    const cache = createMediaCache(backend.load);
    let runs = 0;
    effect(() => {
      runs++;
      void cache.load(['a']);
    });
    await settle();
    cache.seed({ ...upload('a'), name: 'renamed.png' });
    strictEqual(runs, 1);
    strictEqual(cache.get('a')?.name, 'renamed.png');
  });

  it('leaves a failed request unresolved and asks again on the next read', async () => {
    let fail = true;
    const backend = loader((uuids) => (fail ? undefined : known(uuids)));
    const cache = createMediaCache(backend.load);
    deepStrictEqual(await cache.load(['a']), [undefined]);
    fail = false;
    strictEqual(cache.get('a'), undefined);
    await settle();
    strictEqual(cache.get('a')?.UUID, 'a');
    deepStrictEqual(backend.calls, [['a'], ['a']]);
  });

  it('refreshes every cached record in one request and keeps the value until the answer lands', async () => {
    let name = 'before';
    const backend = loader((uuids) => uuids.map((uuid) => ({ ...upload(uuid), name })));
    const cache = createMediaCache(backend.load);
    await cache.load(['a', 'b']);
    name = 'after';
    cache.refresh();
    strictEqual(cache.get('a')?.name, 'before');
    await settle();
    strictEqual(cache.get('a')?.name, 'after');
    strictEqual(cache.get('b')?.name, 'after');
    deepStrictEqual(backend.calls, [
      ['a', 'b'],
      ['a', 'b'],
    ]);
  });

  it('evicts the least recently read record over capacity, never one still owed an answer', async () => {
    const backend = loader(known);
    const cache = createMediaCache(backend.load, { capacity: 2 });
    await cache.load(['a', 'b']);
    cache.get('a');
    cache.get('c');
    await settle();
    deepStrictEqual(backend.calls, [['a', 'b'], ['c']]);
    strictEqual(cache.get('a')?.UUID, 'a');
    strictEqual(cache.get('c')?.UUID, 'c');
    strictEqual(cache.get('b'), undefined);
  });
});
