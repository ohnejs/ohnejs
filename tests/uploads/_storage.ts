import type { StorageAdapter, StorageWriteMeta } from '../../src/uploads/storage/adapter.ts';

import { digest } from '../../src/utils/crypto/digest.ts';
import { uuidv7 } from '../../src/utils/uuid/uuidv7.ts';

/**
 * The effects `failNext` can make throw once.
 * `part` fails `parts.write`, and `begin`, `complete` and `abort` fail the `parts` calls of those names.
 */
export type MemoryStorageOp =
  | 'move'
  | 'delete'
  | 'setPrivate'
  | 'begin'
  | 'part'
  | 'complete'
  | 'abort';

/**
 * A `StorageAdapter` over a `Map`, with the objects, their meta, and their visibility exposed.
 * `metas` holds the meta each object was stored with, a part-wise write's from its `begin`.
 * `unfinished` holds the parts of every part-wise write not yet completed or aborted, keyed by handle.
 * `failNext` makes the next effect of one kind throw once.
 */
export interface MemoryStorage extends StorageAdapter {
  objects: Map<string, Uint8Array>;
  metas: Map<string, StorageWriteMeta>;
  visibility: Map<string, boolean>;
  unfinished: Map<string, Uint8Array<ArrayBuffer>[]>;
  failNext(op: MemoryStorageOp): void;
}

/**
 * Builds an adapter that keeps every object in `objects`, keyed by path.
 * `move` and `delete` also carry a prefix's descendants, as a folder effect needs.
 * An object's meta and visibility move with it and go with it on a delete.
 * `setPrivate` records the object at the path and every one under it in `visibility`, `true` for private.
 * Like `move` and `delete`, it passes over a path that holds nothing.
 * `parts` takes parts of any size and count, and keeps them in part order until `complete` or `abort`.
 * A part's receipt is the MD5 of its bytes, and `complete` refuses a receipt its part does not match.
 * `complete` concatenates the listed parts into `objects`; a replay resolves while the path holds an object.
 * `minSize` and `maxCount` are plain fields a test may change, and a test may delete `parts` whole.
 * `failNext(op)` makes the next call of that op throw once, then the adapter works again.
 */
export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, Uint8Array>();
  const metas = new Map<string, StorageWriteMeta>();
  const begun = new Map<string, StorageWriteMeta>();
  const visibility = new Map<string, boolean>();
  const unfinished = new Map<string, Uint8Array<ArrayBuffer>[]>();
  let failing: MemoryStorageOp | null = null;

  const fail = (op: MemoryStorageOp): void => {
    if (failing !== op) return;
    failing = null;
    throw new Error(`memory storage ${op} failed`);
  };
  const under = (prefix: string): string[] =>
    [...objects.keys()].filter((key) => key.startsWith(`${prefix}/`));
  const shift = <V>(map: Map<string, V>, from: string, to: string): void => {
    const value = map.get(from);
    map.delete(from);
    if (value === undefined) map.delete(to);
    else map.set(to, value);
  };
  const carry = (from: string, to: string): void => {
    shift(metas, from, to);
    shift(visibility, from, to);
  };
  const forget = (path: string): void => {
    objects.delete(path);
    metas.delete(path);
    visibility.delete(path);
  };
  const receipt = (bytes: Uint8Array): string => digest('md5', bytes).toHex();
  const draft = (handle: string): Uint8Array<ArrayBuffer>[] => {
    const parts = unfinished.get(handle);
    if (parts === undefined) throw new Error(`memory storage has no write ${handle}`);
    return parts;
  };

  return {
    objects,
    metas,
    visibility,
    unfinished,
    failNext(op) {
      failing = op;
    },
    async write(path, body, meta) {
      objects.set(path, await new Response(body).bytes());
      metas.set(path, meta);
    },
    async read(path, range) {
      const bytes = objects.get(path);
      if (bytes === undefined) return null;
      const slice = bytes.subarray(range?.start ?? 0, (range?.end ?? bytes.byteLength - 1) + 1);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      });
      return { body, size: bytes.byteLength };
    },
    async stat(path) {
      const bytes = objects.get(path);
      return bytes === undefined ? null : { size: bytes.byteLength };
    },
    async *list(prefix = '') {
      for (const key of objects.keys()) {
        if (prefix === '' || key === prefix || key.startsWith(`${prefix}/`)) yield key;
      }
    },
    async move(from, to) {
      fail('move');
      const bytes = objects.get(from);
      if (bytes !== undefined) {
        objects.delete(from);
        objects.set(to, bytes);
        carry(from, to);
      }
      for (const key of under(from)) {
        const target = to + key.slice(from.length);
        objects.set(target, objects.get(key)!);
        objects.delete(key);
        carry(key, target);
      }
    },
    async delete(path) {
      fail('delete');
      forget(path);
      for (const key of under(path)) forget(key);
    },
    async setPrivate(path, value) {
      fail('setPrivate');
      if (objects.has(path)) visibility.set(path, value);
      for (const key of under(path)) visibility.set(key, value);
    },
    parts: {
      minSize: 1,
      maxCount: Infinity,
      async begin(_path, meta) {
        fail('begin');
        const handle = uuidv7();
        unfinished.set(handle, []);
        begun.set(handle, meta);
        return handle;
      },
      async write(_path, handle, { number, bytes }) {
        fail('part');
        const parts = draft(handle);
        parts[number - 1] = bytes.slice();
        return receipt(bytes);
      },
      async complete(path, handle, receipts) {
        fail('complete');
        if (!unfinished.has(handle) && objects.has(path)) return;
        const parts = draft(handle);
        const listed = receipts.map((expected, index) => {
          const part = parts[index];
          if (part === undefined || receipt(part) !== expected) {
            throw new Error(`memory storage part ${index + 1} does not match its receipt`);
          }
          return part;
        });
        objects.set(path, await new Blob(listed).bytes());
        metas.set(path, begun.get(handle)!);
        unfinished.delete(handle);
        begun.delete(handle);
      },
      async abort(_path, handle) {
        fail('abort');
        unfinished.delete(handle);
        begun.delete(handle);
      },
    },
  };
}
