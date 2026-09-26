import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import type { StorageAdapter, StoragePart } from '../../../src/uploads/storage/adapter.ts';

import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { createFSStorage } from '../../../src/uploads/storage/fs.ts';
import { truncateWithHash } from '../../../src/utils/crypto/index.ts';

const encoder = new TextEncoder();

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return ReadableStream.from(chunks.map((chunk) => encoder.encode(chunk)));
}

function failingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('partial'));
      controller.error(new Error('stream broke'));
    },
  });
}

function text(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

function stalledStream(chunk: string): {
  body: ReadableStream<Uint8Array>;
  pulled: Promise<void>;
  release: () => void;
} {
  let release!: () => void;
  let pulled!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (pulled = resolve));
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      pulled();
      await gate;
      controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { body, pulled: started, release };
}

function pruneBefore(
  name: 'open' | 'rename',
  dir: string,
): { calls: () => number; restore: () => void } {
  const original = fsPromises[name] as (...args: unknown[]) => Promise<unknown>;
  let pruned = false;
  const mocked = mock.method(fsPromises, name, (...args: unknown[]) => {
    if (!pruned) {
      pruned = true;
      rmSync(dir, { recursive: true, force: true });
    }
    return original.apply(fsPromises, args);
  });
  syncBuiltinESMExports();
  return {
    calls: () => mocked.mock.callCount(),
    restore() {
      mocked.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

describe('createFSStorage', () => {
  let dir: string;
  let storage: StorageAdapter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-fs-storage-'));
    storage = createFSStorage(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes an object and reads it back whole', async () => {
    await storage.write('photos/2024/sunset.jpg', streamOf('hello world'), { type: 'image/jpeg' });

    strictEqual(readFileSync(join(dir, 'photos/2024/sunset.jpg'), 'utf8'), 'hello world');
    const object = await storage.read('photos/2024/sunset.jpg');
    ok(object);
    strictEqual(object.size, 11);
    strictEqual(await text(object.body), 'hello world');
  });

  it('streams a chunked body into one file', async () => {
    await storage.write('chunked.txt', streamOf('hel', 'lo ', 'world'), { type: 'text/plain' });

    strictEqual(readFileSync(join(dir, 'chunked.txt'), 'utf8'), 'hello world');
  });

  it('reads a range from a start offset to the end', async () => {
    await storage.write('range.txt', streamOf('hello world'), { type: 'text/plain' });

    const object = await storage.read('range.txt', { start: 6 });
    ok(object);
    strictEqual(await text(object.body), 'world');
    strictEqual(object.size, 11);
  });

  it('reads a range with an inclusive end', async () => {
    await storage.write('range.txt', streamOf('hello world'), { type: 'text/plain' });

    const object = await storage.read('range.txt', { start: 0, end: 4 });
    ok(object);
    strictEqual(await text(object.body), 'hello');
    strictEqual(object.size, 11);
  });

  it('resolves null for a missing object or a directory', async () => {
    await storage.write('photos/a.jpg', streamOf('a'), { type: 'image/jpeg' });

    strictEqual(await storage.read('photos/missing.jpg'), null);
    strictEqual(await storage.read('photos'), null);
    strictEqual(await storage.stat('photos/missing.jpg'), null);
    strictEqual(await storage.stat('photos'), null);
  });

  it('stats an object', async () => {
    await storage.write('photos/a.jpg', streamOf('hello world'), { type: 'image/jpeg' });

    deepStrictEqual(await storage.stat('photos/a.jpg'), { size: 11 });
  });

  it('overwrites in place and leaves no temp file behind', async () => {
    await storage.write('photos/a.jpg', streamOf('first'), { type: 'image/jpeg' });
    await storage.write('photos/a.jpg', streamOf('second'), { type: 'image/jpeg' });

    strictEqual(readFileSync(join(dir, 'photos/a.jpg'), 'utf8'), 'second');
    deepStrictEqual(await storage.stat('photos/a.jpg'), { size: 6 });
    deepStrictEqual(readdirSync(join(dir, 'photos')), ['a.jpg']);
  });

  it('keeps the previous object and no temp file when a write fails', async () => {
    await storage.write('photos/a.jpg', streamOf('first'), { type: 'image/jpeg' });

    await rejects(
      storage.write('photos/a.jpg', failingStream(), { type: 'image/jpeg' }),
      /stream broke/,
    );
    strictEqual(readFileSync(join(dir, 'photos/a.jpg'), 'utf8'), 'first');
    deepStrictEqual(readdirSync(join(dir, 'photos')), ['a.jpg']);
  });

  it('leaves nothing behind when the first write of an object fails', async () => {
    await rejects(
      storage.write('photos/a.jpg', failingStream(), { type: 'image/jpeg' }),
      /stream broke/,
    );

    deepStrictEqual(readdirSync(join(dir, 'photos')), []);
    strictEqual(await storage.stat('photos/a.jpg'), null);
  });

  it('holds its directory against a delete that prunes beside an in-flight write', async () => {
    const { body, pulled, release } = stalledStream('late');
    const writing = storage.write('photos/late.jpg', body, { type: 'image/jpeg' });
    await pulled;

    await storage.delete('photos/gone.jpg');
    release();
    await writing;

    strictEqual(readFileSync(join(dir, 'photos/late.jpg'), 'utf8'), 'late');
    deepStrictEqual(readdirSync(join(dir, 'photos')), ['late.jpg']);
  });

  it('recreates a directory pruned between its creation and the temp file opening', async () => {
    const opening = pruneBefore('open', join(dir, 'photos'));
    try {
      await storage.write('photos/a.jpg', streamOf('survived'), { type: 'image/jpeg' });
    } finally {
      opening.restore();
    }

    strictEqual(opening.calls(), 2);
    strictEqual(readFileSync(join(dir, 'photos/a.jpg'), 'utf8'), 'survived');
    deepStrictEqual(readdirSync(join(dir, 'photos')), ['a.jpg']);
  });

  it('recreates a directory pruned between its creation and the move landing', async () => {
    await storage.write('a.txt', streamOf('moved'), { type: 'text/plain' });

    const renaming = pruneBefore('rename', join(dir, 'deep'));
    try {
      await storage.move('a.txt', 'deep/nested/a.txt');
    } finally {
      renaming.restore();
    }

    strictEqual(renaming.calls(), 2);
    strictEqual(await storage.stat('a.txt'), null);
    strictEqual(readFileSync(join(dir, 'deep/nested/a.txt'), 'utf8'), 'moved');
  });

  it('moves a file, creating the parent of the target', async () => {
    await storage.write('a.txt', streamOf('moved'), { type: 'text/plain' });

    await storage.move('a.txt', 'deep/nested/a.txt');

    strictEqual(await storage.stat('a.txt'), null);
    strictEqual(readFileSync(join(dir, 'deep/nested/a.txt'), 'utf8'), 'moved');
  });

  it('moves a file over an existing one, replacing it', async () => {
    await storage.write('a.txt', streamOf('new'), { type: 'text/plain' });
    await storage.write('b.txt', streamOf('old'), { type: 'text/plain' });

    await storage.move('a.txt', 'b.txt');

    strictEqual(await storage.stat('a.txt'), null);
    strictEqual(readFileSync(join(dir, 'b.txt'), 'utf8'), 'new');
  });

  it('moves a prefix with everything beneath it', async () => {
    await storage.write('photos/2024/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write('photos/2024/b.jpg', streamOf('b'), { type: 'image/jpeg' });

    await storage.move('photos/2024', 'archive/2024');

    strictEqual(existsSync(join(dir, 'photos/2024')), false);
    strictEqual(readFileSync(join(dir, 'archive/2024/a.jpg'), 'utf8'), 'a');
    strictEqual(readFileSync(join(dir, 'archive/2024/b.jpg'), 'utf8'), 'b');
    strictEqual(await storage.stat('photos/2024/a.jpg'), null);
  });

  it('replaces what a stray or an interrupted copy left at the target of a prefix move', async () => {
    await storage.write('photos/2024/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write('archive/2024/stray.txt', streamOf('s'), { type: 'text/plain' });
    await storage.write('docs/notes.txt', streamOf('n'), { type: 'text/plain' });
    await storage.write('archive/notes', streamOf('file'), { type: 'text/plain' });

    await storage.move('photos/2024', 'archive/2024');
    await storage.move('docs', 'archive/notes');

    deepStrictEqual(readdirSync(join(dir, 'archive/2024')), ['a.jpg']);
    strictEqual(readFileSync(join(dir, 'archive/notes/notes.txt'), 'utf8'), 'n');
    strictEqual(existsSync(join(dir, 'photos/2024')), false);
    strictEqual(existsSync(join(dir, 'docs')), false);
  });

  it('treats a move of a missing source as a no-op', async () => {
    await storage.move('ghost.txt', 'deep/ghost.txt');

    strictEqual(existsSync(join(dir, 'deep')), false);
  });

  it('deletes a file and prunes the parents it leaves empty', async () => {
    await storage.write('photos/2024/sunset.jpg', streamOf('x'), { type: 'image/jpeg' });
    await storage.write('docs/readme.txt', streamOf('y'), { type: 'text/plain' });

    await storage.delete('photos/2024/sunset.jpg');

    strictEqual(existsSync(join(dir, 'photos')), false);
    strictEqual(existsSync(dir), true);
    strictEqual(readFileSync(join(dir, 'docs/readme.txt'), 'utf8'), 'y');
  });

  it('keeps a parent that still holds a sibling', async () => {
    await storage.write('photos/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write('photos/b.jpg', streamOf('b'), { type: 'image/jpeg' });

    await storage.delete('photos/a.jpg');

    deepStrictEqual(readdirSync(join(dir, 'photos')), ['b.jpg']);
  });

  it('deletes a prefix with everything beneath it', async () => {
    await storage.write('photos/2024/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write('photos/b.jpg', streamOf('b'), { type: 'image/jpeg' });

    await storage.delete('photos');

    strictEqual(existsSync(join(dir, 'photos')), false);
    strictEqual(await storage.stat('photos/2024/a.jpg'), null);
    strictEqual(await storage.stat('photos/b.jpg'), null);
  });

  it('removes the temp files a crashed write left beside a key it deletes', async () => {
    await storage.write('photos/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    const temp = join(dir, 'photos/.a.jpg.01991a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b.tmp');
    writeFileSync(temp, 'partial');
    writeFileSync(join(dir, 'photos/a.jpg.keep'), 'k');

    await storage.delete('photos/a.jpg');

    deepStrictEqual(readdirSync(join(dir, 'photos')), ['a.jpg.keep']);
  });

  it('keeps a folder named like a temp file beside a key it deletes', async () => {
    const folder = 'photos/.a.jpg.01991a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b.tmp';
    await storage.write('photos/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write(`${folder}/b.jpg`, streamOf('b'), { type: 'image/jpeg' });

    await storage.delete('photos/a.jpg');

    strictEqual(readFileSync(join(dir, folder, 'b.jpg'), 'utf8'), 'b');
  });

  it('keeps and lists an object whose key is another key plus a temp suffix', async () => {
    const twin = 'photos/a.jpg.01991a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b.tmp';
    await storage.write('photos/a.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write(twin, streamOf('t'), { type: 'application/octet-stream' });

    await storage.delete('photos/a.jpg');

    strictEqual(readFileSync(join(dir, twin), 'utf8'), 't');
    deepStrictEqual(await Array.fromAsync(storage.list!('photos')), [twin]);
  });

  it('keeps the temp of a write in progress to a longer name beside a key it deletes', async () => {
    await storage.write('docs/report', streamOf('r'), { type: 'text/plain' });
    const { body, pulled, release } = stalledStream('pdf');
    const writing = storage.write('docs/report.pdf', body, { type: 'application/pdf' });
    await pulled;

    await storage.delete('docs/report');
    release();
    await writing;

    strictEqual(readFileSync(join(dir, 'docs/report.pdf'), 'utf8'), 'pdf');
  });

  it('writes, lists and deletes an object whose name fills 255 bytes', async () => {
    const key = `docs/${'a'.repeat(251)}.txt`;
    await storage.write(key, streamOf('long'), { type: 'text/plain' });

    strictEqual(readFileSync(join(dir, key), 'utf8'), 'long');
    deepStrictEqual(await Array.fromAsync(storage.list!('docs')), [key]);
    await storage.delete(key);
    strictEqual(existsSync(join(dir, 'docs')), false);
  });

  it('removes the crash temp of a long name, keeping a sibling that shares its head', async () => {
    const one = `${'b'.repeat(240)}-one.txt`;
    const two = `${'b'.repeat(240)}-two.txt`;
    const temp = (name: string) =>
      `.${truncateWithHash(name, 213)}.01991a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b.tmp`;
    await storage.write(`e/${one}`, streamOf('1'), { type: 'text/plain' });
    writeFileSync(join(dir, 'e', temp(one)), 'crash');
    writeFileSync(join(dir, 'e', temp(two)), 'crash');

    await storage.delete(`e/${one}`);

    deepStrictEqual(readdirSync(join(dir, 'e')), [temp(two)]);
  });

  it('treats a delete of a missing path as a no-op', async () => {
    await storage.delete('nothing/here.txt');

    strictEqual(existsSync(join(dir, 'nothing')), false);
    deepStrictEqual(readdirSync(dir), []);
  });

  it('lists every object, a dot-prefixed one included, but never a write in progress', async () => {
    await storage.write('photos/2024/sunset.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write('.tmp/staged', streamOf('b'), { type: 'text/plain' });
    const { body, pulled, release } = stalledStream('late');
    const writing = storage.write('photos/late.jpg', body, { type: 'image/jpeg' });
    await pulled;

    const listed = await Array.fromAsync(storage.list!());
    release();
    await writing;

    deepStrictEqual(listed.sort(), ['.tmp/staged', 'photos/2024/sunset.jpg']);
  });

  it('lists the object at a prefix, or every object under it', async () => {
    await storage.write('photos/2024/sunset.jpg', streamOf('a'), { type: 'image/jpeg' });
    await storage.write('photos/dusk.jpg', streamOf('b'), { type: 'image/jpeg' });
    await storage.write('photoshop.psd', streamOf('c'), { type: 'image/vnd.adobe.photoshop' });

    deepStrictEqual((await Array.fromAsync(storage.list!('photos'))).sort(), [
      'photos/2024/sunset.jpg',
      'photos/dusk.jpg',
    ]);
    deepStrictEqual(await Array.fromAsync(storage.list!('photos/dusk.jpg')), ['photos/dusk.jpg']);
    deepStrictEqual(await Array.fromAsync(storage.list!('missing')), []);
  });

  it('refuses a path that escapes the root', async () => {
    const body = streamOf('x');
    await rejects(storage.write('../escape.txt', body, { type: 'text/plain' }), isOhneError);
    await rejects(storage.read('../escape.txt'), /escapes the uploads root/);
    await rejects(storage.stat('/etc/passwd'), /escapes the uploads root/);
    await rejects(storage.move('a.txt', '../escape.txt'), /escapes the uploads root/);
    await rejects(storage.delete('..'), /escapes the uploads root/);
    await rejects(Array.fromAsync(storage.list!('..')), /escapes the uploads root/);
    strictEqual(existsSync(join(dir, '..', 'escape.txt')), false);
  });

  it('resolves a relative root against the working directory', async () => {
    const relativeStorage = createFSStorage(relative(process.cwd(), dir));

    await relativeStorage.write('a.txt', streamOf('relative'), { type: 'text/plain' });

    strictEqual(readFileSync(join(dir, 'a.txt'), 'utf8'), 'relative');
  });

  it('resolves a relative root against the app root of a loaded stack, not the working directory', async () => {
    const cwd = process.cwd();
    const app = join(dir, 'app');
    useLayers().add({ path: app, input: {} });
    process.chdir(dir);
    try {
      await createFSStorage('files').write('a.txt', streamOf('app'), { type: 'text/plain' });
    } finally {
      process.chdir(cwd);
      useLayers().remove(app);
    }

    strictEqual(readFileSync(join(app, 'files', 'a.txt'), 'utf8'), 'app');
    strictEqual(existsSync(join(dir, 'files')), false);
  });

  describe('parts', () => {
    const path = 'videos/intro.mp4';
    const meta = { type: 'video/mp4', size: 10 };

    /**
     * Part `number` of the object at `path`, on a grid of 5-byte parts.
     */
    function part(number: number, value: string): StoragePart {
      return { number, offset: (number - 1) * 5, bytes: encoder.encode(value) };
    }

    it('assembles the parts written in order into an object that appears only at complete', async () => {
      const handle = await storage.parts!.begin(path, meta);
      const receipts = [
        await storage.parts!.write(path, handle, part(1, 'hello')),
        await storage.parts!.write(path, handle, part(2, 'world')),
      ];

      deepStrictEqual(readdirSync(join(dir, 'videos')), [`.intro.mp4.${handle}.tmp`]);
      strictEqual(await storage.stat(path), null);
      await storage.parts!.complete(path, handle, receipts);

      deepStrictEqual(await storage.stat(path), { size: 10 });
      strictEqual(readFileSync(join(dir, path), 'utf8'), 'helloworld');
      deepStrictEqual(readdirSync(join(dir, 'videos')), ['intro.mp4']);
    });

    it('replaces a part written again', async () => {
      const handle = await storage.parts!.begin(path, meta);
      await storage.parts!.write(path, handle, part(1, 'hello'));
      await storage.parts!.write(path, handle, part(1, 'HELLO'));
      await storage.parts!.write(path, handle, part(2, 'world'));

      await storage.parts!.complete(path, handle, ['', '']);

      strictEqual(readFileSync(join(dir, path), 'utf8'), 'HELLOworld');
    });

    it('resolves a complete replayed after the object landed', async () => {
      const handle = await storage.parts!.begin(path, meta);
      await storage.parts!.write(path, handle, part(1, 'hello'));
      await storage.parts!.write(path, handle, part(2, 'world'));
      await storage.parts!.complete(path, handle, ['', '']);

      await storage.parts!.complete(path, handle, ['', '']);

      strictEqual(readFileSync(join(dir, path), 'utf8'), 'helloworld');
    });

    it('refuses to complete a write that is gone when nothing landed at its path', async () => {
      const handle = await storage.parts!.begin(path, meta);
      await storage.parts!.abort(path, handle);

      await rejects(storage.parts!.complete(path, handle, []), { code: 'ENOENT' });
      strictEqual(await storage.stat(path), null);
    });

    it('removes the temp and the directory it empties on abort, and aborts again as a no-op', async () => {
      const handle = await storage.parts!.begin(path, meta);
      await storage.parts!.write(path, handle, part(1, 'hello'));

      await storage.parts!.abort(path, handle);
      await storage.parts!.abort(path, handle);

      strictEqual(existsSync(join(dir, 'videos')), false);
      await rejects(storage.parts!.write(path, handle, part(2, 'world')), { code: 'ENOENT' });
    });

    it('keeps an unfinished write out of every listing', async () => {
      await storage.write('videos/outro.mp4', streamOf('outro'), { type: 'video/mp4' });
      const handle = await storage.parts!.begin(path, meta);
      await storage.parts!.write(path, handle, part(1, 'hello'));

      deepStrictEqual(await Array.fromAsync(storage.list!()), ['videos/outro.mp4']);
      deepStrictEqual(await Array.fromAsync(storage.list!('videos')), ['videos/outro.mp4']);
    });

    it('removes an abandoned write with a delete of its path', async () => {
      const handle = await storage.parts!.begin(path, meta);
      await storage.parts!.write(path, handle, part(1, 'hello'));

      await storage.delete(path);

      strictEqual(existsSync(join(dir, 'videos')), false);
    });

    it('recreates a directory pruned between its creation and the temp opening at begin', async () => {
      const opening = pruneBefore('open', join(dir, 'videos'));
      let handle = '';
      try {
        handle = await storage.parts!.begin(path, meta);
      } finally {
        opening.restore();
      }

      strictEqual(opening.calls(), 2);
      deepStrictEqual(readdirSync(join(dir, 'videos')), [`.intro.mp4.${handle}.tmp`]);
    });

    it('refuses a part-wise write to a path that escapes the root', async () => {
      const escape = '../escape.mp4';
      const handle = '01991a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
      await rejects(storage.parts!.begin(escape, meta), /escapes the uploads root/);
      await rejects(
        storage.parts!.write(escape, handle, part(1, 'hello')),
        /escapes the uploads root/,
      );
      await rejects(storage.parts!.complete(escape, handle, []), /escapes the uploads root/);
      await rejects(storage.parts!.abort(escape, handle), /escapes the uploads root/);
    });
  });
});
