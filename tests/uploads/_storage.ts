import type { StorageAdapter } from '../../src/uploads/storage/adapter.ts';

/**
 * A `StorageAdapter` over a `Map`, with the objects exposed and a switch to fail the next effect once.
 */
export interface MemoryStorage extends StorageAdapter {
  objects: Map<string, Uint8Array>;
  failNext(op: 'move' | 'delete'): void;
}

/**
 * Builds an adapter that keeps every object in `objects`, keyed by path.
 * `move` and `delete` also carry a prefix's descendants, as a folder effect needs.
 * `failNext(op)` makes the next call of that op throw once, then the adapter works again.
 */
export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, Uint8Array>();
  let failing: 'move' | 'delete' | null = null;

  const fail = (op: 'move' | 'delete'): void => {
    if (failing !== op) return;
    failing = null;
    throw new Error(`memory storage ${op} failed`);
  };
  const under = (prefix: string): string[] =>
    [...objects.keys()].filter((key) => key.startsWith(`${prefix}/`));

  return {
    objects,
    failNext(op) {
      failing = op;
    },
    async write(path, body) {
      objects.set(path, await new Response(body).bytes());
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
    async move(from, to) {
      fail('move');
      const bytes = objects.get(from);
      if (bytes !== undefined) {
        objects.delete(from);
        objects.set(to, bytes);
      }
      for (const key of under(from)) {
        objects.set(to + key.slice(from.length), objects.get(key)!);
        objects.delete(key);
      }
    },
    async delete(path) {
      fail('delete');
      objects.delete(path);
      for (const key of under(path)) objects.delete(key);
    },
  };
}
