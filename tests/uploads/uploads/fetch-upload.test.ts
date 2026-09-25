import type { AddressInfo, Socket } from 'node:net';

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { EventEmitter, once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { after, describe, it } from 'node:test';
import { inspect } from 'node:util';

import type { Config } from '../../../src/ohne/layers/config.ts';

import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../src/ohne/query/write/errors.ts';
import { fetchUpload } from '../../../src/uploads/uploads/fetch-upload.ts';
import { freePort } from '../../../src/utils/net/free-port.ts';
import { JPEG_HEAD, png, storage, text } from '../_fixture.ts';

useEnv().set('UPLOADS_SECRET', 'secret');

const LAYER = '/uploads-fetch';

const LOOPBACK = ['127.0.0.1/32', '::1/128'];

const AXE = png(64, 32);

const LARGE = 200 * 1024;

const CREST = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg">${'<rect/>'.repeat(3 * 149797)}</svg>`,
);

/**
 * Every path the server was asked for, in order, so a refusal can prove nothing was sent.
 */
const hits: string[] = [];

/**
 * The request headers of every request the server saw.
 */
const heads: IncomingHttpHeaders[] = [];

/**
 * Every `ip:port` a client socket began to connect to, in order, so a refusal can prove nothing was dialed.
 */
const dials: string[] = [];

/**
 * Emits a path when its response closes before it finished, that is when the client hung up.
 */
const gone = new EventEmitter();

const ROUTES: Record<string, (res: ServerResponse) => void> = {
  '/files/axe.png': (res) =>
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': AXE.length }).end(AXE),
  '/download': (res) =>
    res
      .writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="Frostmourne Blade.png"',
        'content-length': AXE.length,
      })
      .end(AXE),
  '/redirect': (res) => res.writeHead(302, { location: '/files/axe.png' }).end(),
  '/photo': (res) =>
    res
      .writeHead(200, { 'content-type': 'image/jpeg', 'content-length': JPEG_HEAD.length })
      .end(JPEG_HEAD),
  '/disguised': (res) =>
    res
      .writeHead(200, { 'content-type': 'image/png', 'content-length': JPEG_HEAD.length })
      .end(JPEG_HEAD),
  '/disguised.png': (res) =>
    res
      .writeHead(200, { 'content-type': 'image/jpeg', 'content-length': JPEG_HEAD.length })
      .end(JPEG_HEAD),
  '/missing': (res) => res.writeHead(404).end(),
  '/declared': (res) =>
    res.writeHead(200, { 'content-length': LARGE }).end(Buffer.alloc(LARGE, 'a')),
  '/streamed': (res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write(Buffer.alloc(LARGE / 2, 'a'));
    res.end(Buffer.alloc(LARGE / 2, 'a'));
  },
  '/page': (res) => {
    res.writeHead(200, {
      'content-type': 'text/html',
      'content-disposition': 'attachment; filename="page.html"',
    });
    res.write('<p>Jaina Proudmoore');
  },
  '/stall': (res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write('Sylvanas');
  },
  '/crest.svg': (res) => {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'content-length': CREST.length });
    res.flushHeaders();
    setTimeout(() => {
      if (!res.destroyed) res.end(CREST);
    }, 100);
  },
};

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  hits.push(path);
  heads.push(req.headers);
  res.on('close', () => {
    if (!res.writableFinished) gone.emit(path);
  });
  const handle = ROUTES[path];
  if (handle) handle(res);
  else res.writeHead(404).end();
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
subscribe('net.client.socket', recordDials);

after(() => {
  unsubscribe('net.client.socket', recordDials);
  server.closeAllConnections();
  server.close();
});

/**
 * Records every connection attempt of a new client socket into `dials`.
 */
function recordDials(message: unknown): void {
  const { socket } = message as { socket: Socket };
  socket.on('connectionAttempt', (ip: string, port: number) => dials.push(`${ip}:${port}`));
}

function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function temps(): string[] {
  return [...storage.objects.keys()].filter((key) => key.startsWith('.tmp/'));
}

/**
 * Runs `run` with `uploads` config stacked on top, loopback fetchable unless `uploads.fetch` says otherwise.
 */
async function withUploads(
  uploads: NonNullable<Config['uploads']>,
  run: () => Promise<void>,
): Promise<void> {
  useLayers().add({ path: LAYER, input: { uploads: { fetch: { allow: LOOPBACK }, ...uploads } } });
  try {
    await run();
  } finally {
    useLayers().remove(LAYER);
  }
}

async function failure(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  return (await caught(run)).errors;
}

async function caught(run: () => Promise<unknown>): Promise<{ errors: Record<string, unknown> }> {
  let thrown: unknown;
  await rejects(run, (error: unknown) => {
    thrown = error;
    return isValidationError(error);
  });
  return thrown as { errors: Record<string, unknown> };
}

describe('fetchUpload', () => {
  it('stores the fetched file at its canonical path, typed, hashed, and measured', async () => {
    await withUploads({}, async () => {
      const upload = await fetchUpload({
        url: `${origin}/files/axe.png?sig=Thrall`,
        directory: 'Heroes',
        author: null,
      });
      strictEqual(upload.path, 'heroes/axe.png');
      strictEqual(upload.type, 'image/png');
      strictEqual(upload.size, AXE.byteLength);
      strictEqual(upload.hash, sha256(AXE));
      strictEqual(upload.width, 64);
      strictEqual(upload.height, 32);
      deepStrictEqual(storage.objects.get('heroes/axe.png'), AXE);
      strictEqual(heads.at(-1)?.['user-agent'], 'ohne');
      deepStrictEqual(temps(), []);
      strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    });
  });

  it('names the file from its Content-Disposition', async () => {
    await withUploads({}, async () => {
      const upload = await fetchUpload({ url: `${origin}/download`, directory: 'named' });
      strictEqual(upload.name, 'frostmourne-blade.png');
      strictEqual(upload.type, 'image/png');
    });
  });

  it('names the file from the final URL after a redirect', async () => {
    await withUploads({}, async () => {
      const upload = await fetchUpload({ url: `${origin}/redirect`, directory: 'redirected' });
      strictEqual(upload.path, 'redirected/axe.png');
    });
  });

  it('appends the extension the Content-Type stands for to a name without one', async () => {
    await withUploads({}, async () => {
      const fromURL = await fetchUpload({ url: `${origin}/photo`, directory: 'typed' });
      strictEqual(fromURL.name, 'photo.jpg');
      strictEqual(fromURL.type, 'image/jpeg');
      const fromCaller = await fetchUpload({
        url: `${origin}/photo`,
        directory: 'typed',
        name: 'Varian',
      });
      strictEqual(fromCaller.name, 'varian.jpg');
    });
  });

  it('prefers the caller name over the response, and an empty one falls through', async () => {
    await withUploads({}, async () => {
      const named = await fetchUpload({
        url: `${origin}/download`,
        directory: 'chosen',
        name: 'Arthas.PNG',
      });
      strictEqual(named.name, 'arthas.png');
      const empty = await fetchUpload({ url: `${origin}/download`, directory: 'chosen', name: '' });
      strictEqual(empty.name, 'frostmourne-blade.png');
    });
  });

  it('refuses a named type outside uploads.types before any request', async () => {
    await withUploads({ types: ['image'] }, async () => {
      const before = hits.length;
      const errors = await failure(() =>
        fetchUpload({ url: `${origin}/files/axe.png`, name: 'page.html' }),
      );
      deepStrictEqual(errors, {
        name: { key: 'uploads.errors.typeNotAllowed', params: { type: 'text/html' } },
      });
      strictEqual(hits.length, before);
    });
  });

  it('hangs up on a body it refuses unread', { timeout: 5000 }, async () => {
    await withUploads({ types: ['image'] }, async () => {
      const hungUp = once(gone, '/page');
      const errors = await failure(() => fetchUpload({ url: `${origin}/page` }));
      deepStrictEqual(errors, {
        name: { key: 'uploads.errors.typeNotAllowed', params: { type: 'text/html' } },
      });
      await hungUp;
    });
  });

  it('refuses bytes that contradict the Content-Type or the URL extension', async () => {
    await withUploads({}, async () => {
      const mismatch = {
        name: {
          key: 'uploads.errors.contentMismatch',
          params: { type: 'image/png', detected: 'image/jpeg' },
        },
      };
      deepStrictEqual(await failure(() => fetchUpload({ url: `${origin}/disguised` })), mismatch);
      deepStrictEqual(
        await failure(() => fetchUpload({ url: `${origin}/disguised.png` })),
        mismatch,
      );
      deepStrictEqual(temps(), []);
      strictEqual(await queryUntyped('Uploads').where({ name: 'disguised.png' }).exists(), false);
    });
  });

  it('refuses loopback on port 80 unless uploads.fetch.allow admits it, dialing nothing', async () => {
    dials.length = 0;
    const errors = await failure(() => fetchUpload({ url: 'http://127.0.0.1/files/axe.png' }));
    deepStrictEqual(errors, { url: 'uploads.errors.urlUnreachable' });
    deepStrictEqual(dials, []);
  });

  it('answers a refused and an unreachable address alike, naming neither', async () => {
    const refused = await caught(() => fetchUpload({ url: 'http://127.0.0.1/files/axe.png' }));
    const closed = await freePort(0, { host: '127.0.0.1' });
    let unreachable!: { errors: Record<string, unknown> };
    await withUploads({}, async () => {
      unreachable = await caught(() => fetchUpload({ url: `http://127.0.0.1:${closed}/axe.png` }));
    });
    deepStrictEqual(refused.errors, { url: 'uploads.errors.urlUnreachable' });
    deepStrictEqual(unreachable.errors, refused.errors);
    for (const error of [refused, unreachable]) {
      const shown = inspect(error);
      ok(!shown.includes('127.0.0.1') && !shown.includes(String(closed)), shown);
    }
  });

  it('refuses a URL that is not http or https, or carries credentials', async () => {
    await withUploads({}, async () => {
      const before = hits.length;
      const port = new URL(origin).port;
      for (const url of [
        'ftp://127.0.0.1/axe.png',
        'Thrall',
        `http://thrall:lok-tar@127.0.0.1:${port}/files/axe.png`,
      ]) {
        deepStrictEqual(await failure(() => fetchUpload({ url })), {
          url: 'uploads.errors.urlInvalid',
        });
      }
      strictEqual(hits.length, before);
    });
  });

  it('refuses a response other than 200 with its status', async () => {
    await withUploads({}, async () => {
      const errors = await failure(() => fetchUpload({ url: `${origin}/missing` }));
      deepStrictEqual(errors, {
        url: { key: 'uploads.errors.urlStatus', params: { status: 404 } },
      });
    });
  });

  it('refuses a body past uploads.maxFileSize, declared or streamed, leaving nothing', async () => {
    await withUploads({ maxFileSize: '100kb' }, async () => {
      const tooLarge = { url: { key: 'uploads.errors.fileTooLarge', params: { max: '100kb' } } };
      for (const path of ['/declared', '/streamed']) {
        deepStrictEqual(
          await failure(() => fetchUpload({ url: `${origin}${path}`, directory: 'large' })),
          tooLarge,
        );
      }
      deepStrictEqual(temps(), []);
      strictEqual(await queryUntyped('UploadsJournal').count(), 0);
      strictEqual(await queryUntyped('Uploads').where({ directory: 'large' }).exists(), false);
    });
  });

  it('caps a URL named .svg at uploads.maxSVGSize, hanging up before the body', async () => {
    for (const [maxFileSize, max] of [
      ['128mb', '2mb'],
      ['1mb', '1mb'],
    ]) {
      await withUploads({ maxFileSize }, async () => {
        const hungUp = once(gone, '/crest.svg');
        const errors = await failure(() =>
          fetchUpload({ url: `${origin}/crest.svg`, directory: 'crests', name: 'Horde.svg' }),
        );
        deepStrictEqual(errors, { url: { key: 'uploads.errors.fileTooLarge', params: { max } } });
        await hungUp;
      });
    }
    strictEqual(await queryUntyped('Uploads').where({ directory: 'crests' }).exists(), false);
  });

  it('aborts the fetch and hangs up when the signal aborts', { timeout: 5000 }, async () => {
    await withUploads({}, async () => {
      const controller = new AbortController();
      const hungUp = once(gone, '/stall');
      const pending = failure(() =>
        fetchUpload({ url: `${origin}/stall`, directory: 'stalled', signal: controller.signal }),
      );
      while (!hits.includes('/stall')) await once(server, 'request');
      controller.abort();
      deepStrictEqual(await pending, { url: 'uploads.errors.urlUnreachable' });
      await hungUp;
      deepStrictEqual(temps(), []);
      strictEqual(await queryUntyped('UploadsJournal').count(), 0);
    });
  });

  it('422s a directory whose path would pass 768 bytes, staging nothing', async () => {
    await withUploads({}, async () => {
      const segment = 'zuldrak'.repeat(37).slice(0, 255);
      const errors = await failure(() =>
        fetchUpload({
          url: `${origin}/files/axe.png`,
          directory: [segment, segment, segment].join('/'),
        }),
      );
      deepStrictEqual(errors, {
        directory: { key: 'uploads.errors.pathTooLong', params: { max: 768 } },
      });
      strictEqual(await queryUntyped('Uploads').where({ name: segment }).exists(), false);
      deepStrictEqual(temps(), []);
    });
  });

  it('lands a file fetched into a private folder as private', async () => {
    await queryUntyped('Uploads').createOrThrow({
      kind: 'folder',
      directory: '',
      name: 'vault',
      private: true,
    });
    await withUploads({}, async () => {
      const upload = await fetchUpload({ url: `${origin}/files/axe.png`, directory: 'vault' });
      strictEqual(upload.private, true);
      strictEqual(storage.visibility.get('vault/axe.png'), true);
    });
  });

  it('refuses a write outside the reach, keeping no row and no object', async () => {
    await withUploads({}, async () => {
      const errors = await failure(() =>
        fetchUpload({
          url: `${origin}/files/axe.png`,
          directory: 'vault',
          name: 'hidden.png',
          reach: { where: { private: false } },
        }),
      );
      deepStrictEqual(errors, { '': 'uploads.errors.outOfReach' });
      strictEqual(await queryUntyped('Uploads').where({ name: 'hidden.png' }).exists(), false);
      strictEqual(storage.objects.has('vault/hidden.png'), false);
      deepStrictEqual(temps(), []);
    });
  });

  it('stores a chunked body whole, though it declares no length', async () => {
    await withUploads({}, async () => {
      const upload = await fetchUpload({ url: `${origin}/streamed`, directory: 'chunked' });
      strictEqual(upload.path, 'chunked/streamed.txt');
      strictEqual(upload.size, LARGE);
      strictEqual(text(storage.objects.get(upload.path)), 'a'.repeat(LARGE));
    });
  });
});
