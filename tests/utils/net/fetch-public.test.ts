import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { EventEmitter, once } from 'node:events';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createTLSServer } from 'node:https';
import {
  createServer as createTCPServer,
  getDefaultAutoSelectFamily,
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamily,
  setDefaultAutoSelectFamilyAttemptTimeout,
  type AddressInfo,
  type Server,
  type Socket,
} from 'node:net';
import { networkInterfaces } from 'node:os';
import { after, before, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { getCACertificates, setDefaultCACertificates, type TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { nextHop } from '../../../src/utils/net/_hop.ts';
import {
  fetchPublic,
  isFetchPublicError,
  isPublicIP,
  type FetchPublicErrorCode,
  type FetchPublicOptions,
  type PublicResponse,
} from '../../../src/utils/net/index.ts';
import { DALARAN_CERT, DALARAN_KEY } from './_certificate.ts';
import { startDNSServer, type DNSServer } from './_dns-server.ts';

const BODY = 'Jaina Proudmoore';
const LOOPBACK = ['127.0.0.1', '::1'];

/**
 * A body far past what the socket and the stream buffer, so most of it is in flight while a reader pauses.
 */
const LARGE = 4 * 1024 * 1024;

/**
 * Every path a server was asked for, in order, so a refusal can prove nothing was sent.
 */
const hits: string[] = [];

/**
 * Every `ip:port` a client socket began to connect to, in order, so a refusal can prove nothing was dialed.
 */
const dials: string[] = [];

/**
 * The request headers of every request the recording server saw.
 */
const heads: IncomingHttpHeaders[] = [];

/**
 * The server name each TLS client sent, in order.
 */
const sni: TLSSocket['servername'][] = [];

/**
 * Emits `gone <path>` when a response closes before it finished, that is when the client hung up.
 * Emits `hit <path>` when the raw server reads a request.
 */
const served = new EventEmitter();

const ROUTES: Record<string, (res: ServerResponse, query: URLSearchParams) => void> = {
  '/ok': (res) =>
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': BODY.length }).end(BODY),
  '/chunked': (res) => {
    res.writeHead(200);
    res.write('Jaina ');
    res.end('Proudmoore');
  },
  '/redirect': (res, query) =>
    res.writeHead(Number(query.get('status') ?? 302), { location: query.get('to') ?? '' }).end(),
  '/noloc': (res) => res.writeHead(302).end(),
  '/loop': (res) => res.writeHead(302, { location: '/loop' }).end(),
  '/flip': (res) => {
    dns.zone.set('flip.test', { A: ['10.0.0.1'] });
    res.writeHead(302, { location: 'http://flip.test/secret' }).end();
  },
  '/secret': (res) => res.writeHead(200, { 'content-length': 6 }).end('secret'),
  '/status': (res, query) => res.writeHead(Number(query.get('code'))).end(),
  '/gzip': (res) => {
    const body = gzipSync(BODY);
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length }).end(body);
  },
  '/big': (res) => res.writeHead(200, { 'content-length': 2048 }).end(Buffer.alloc(2048)),
  '/large': (res) => res.writeHead(200, { 'content-length': LARGE }).end(Buffer.alloc(LARGE)),
  '/endless': (res) => flood(res.writeHead(200)),
  '/flood': (res) => flood(res.writeHead(302, { location: '/ok' })),
  '/drip': (res) => {
    res.writeHead(200);
    const timer = setInterval(() => res.write('.'), 50);
    res.on('close', () => clearInterval(timer));
  },
  '/stall': (res) => {
    res.writeHead(200);
    res.write('Jaina');
  },
  '/hang': () => {},
};

const RAW: Record<string, (socket: Socket) => void> = {
  '/unframed': (socket) => socket.end(`HTTP/1.1 200 OK\r\n\r\n${BODY}`),
  '/te-gzip': (socket) => socket.end(`HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip\r\n\r\n${BODY}`),
  '/short': (socket) => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nJaina'),
  '/lf': (socket) => socket.end('HTTP/1.1 200 OK\nContent-Length: 5\n\nJaina'),
  '/bighead': (socket) =>
    socket.end(
      `HTTP/1.1 200 OK\r\nX-Big: ${'a'.repeat(20 * 1024)}\r\nContent-Length: 5\r\n\r\nJaina`,
    ),
  '/overlong': (socket) =>
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nJainaTHIS IS NOT A RESPONSE\r\n\r\n'),
  '/upgrade': (socket) =>
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: x\r\nConnection: Upgrade\r\n\r\n'),
  '/slowhead': (socket) => {
    socket.write('HTTP/1.1 200 OK\r\nX-Drip: ');
    const timer = setInterval(() => socket.write('a'), 50);
    socket.on('close', () => clearInterval(timer));
  },
};

const recorder = createServer(record);
const recorder6 = createServer(record);
const recorderTLS = createTLSServer({ key: DALARAN_KEY, cert: DALARAN_CERT }, record);
recorderTLS.on('secureConnection', (socket) => sni.push(socket.servername));
const raw = createTCPServer((socket) => {
  // The client hangs up on refused responses, which resets the socket.
  socket.on('error', () => {});
  socket.once('data', (data) => {
    const path = data.toString('latin1').split(' ')[1] ?? '';
    hits.push(path);
    served.emit(`hit ${path}`);
    RAW[path]?.(socket);
  });
});

const ownPublic = Object.values(networkInterfaces())
  .flatMap((list = []) => list.map(({ address }) => address))
  .find(isPublicIP);

let dns: DNSServer;
let port: number;
let rawPort: number;
let tlsPort: number;
let ipv6: boolean;

/**
 * The recording server: logs the request, then answers from `ROUTES`.
 */
function record(req: IncomingMessage, res: ServerResponse): void {
  hits.push(req.url ?? '');
  heads.push(req.headers);
  const { pathname, searchParams } = new URL(req.url ?? '', 'http://recorder');
  res.on('close', () => {
    if (!res.writableFinished) served.emit(`gone ${pathname}`);
  });
  ROUTES[pathname]?.(res, searchParams);
}

/**
 * Records every connection attempt of a new client socket into `dials`.
 */
function recordDials(message: unknown): void {
  const { socket } = message as { socket: Socket };
  socket.on('connectionAttempt', (ip: string, at: number) => dials.push(`${ip}:${at}`));
}

/**
 * Writes zeros to `res` for as long as the client reads them.
 */
function flood(res: ServerResponse): void {
  const pump = (): void => {
    while (!res.destroyed && res.write(Buffer.alloc(1024)));
  };
  res.on('drain', pump);
  pump();
}

function local(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function rawLocal(path: string): string {
  return `http://127.0.0.1:${rawPort}${path}`;
}

function text(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

function listen(server: Server, at: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(at, host, () => resolve((server.address() as AddressInfo).port));
  });
}

/**
 * `fetchPublic` through the test DNS server, with a deadline short enough to fail a hung test.
 */
function open(url: string | URL, options: FetchPublicOptions = {}): Promise<PublicResponse> {
  return fetchPublic(url, { servers: dns.servers, timeout: 5000, ...options });
}

/**
 * Asserts `promise` rejects with a `FetchPublicError` of `code` that leaks nothing about the destination.
 * `status` is set only for a `status` failure.
 */
async function fails(
  promise: Promise<unknown>,
  code: FetchPublicErrorCode,
  status?: number,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  ok(isFetchPublicError(error), `expected a FetchPublicError, got ${String(error)}`);
  strictEqual(error.code, code);
  strictEqual(error.status, status);
  strictEqual(error.cause, undefined);
  ok(!/[./:@\d]/.test(error.message), `the message names a destination: ${error.message}`);
}

/**
 * Asserts the fetch is refused before any socket began to connect.
 * On port 80 or 443 only the address check refuses; the port rule would let the dial through.
 */
async function refusedUndialed(url: string, options: FetchPublicOptions = {}): Promise<void> {
  dials.length = 0;
  await fails(open(url, options), 'refused');
  deepStrictEqual(dials, []);
}

/**
 * Runs `fetchPublic` in a fresh Node started with `flags` and `env`, since the process reads both at startup.
 * Resolves the body it fetched, or the code it failed with.
 */
async function fetchInChild(
  url: string,
  options: Omit<FetchPublicOptions, 'signal'>,
  { flags = [], env = {} }: { flags?: string[]; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const module = new URL('../../../src/utils/net/fetch-public.ts', import.meta.url).href;
  const script = `
    import { fetchPublic } from ${JSON.stringify(module)};
    const fetched = fetchPublic(${JSON.stringify(url)}, ${JSON.stringify(options)});
    console.log(await fetched.then(({ body }) => new Response(body).text(), (error) => error.code));
  `;
  const args = [...flags, '--input-type=module', '-e', script];
  const { stdout } = await promisify(execFile)(process.execPath, args, {
    env: { ...process.env, ...env },
  });
  return stdout.trim();
}

before(async () => {
  dns = await startDNSServer({
    'loop.test': { A: ['127.0.0.1'] },
    'meta.test': { A: ['169.254.169.254'] },
    'mixed.test': { A: ['127.0.0.1', '10.0.0.1'] },
    'dual.test': { A: ['127.0.0.1'], AAAA: ['fd00:ec2::254'] },
    'imds6.test': { AAAA: ['fd00:ec2::254'] },
    'mapped.test': { AAAA: ['::ffff:127.0.0.1'] },
    'nat64.test': { AAAA: ['64:ff9b::a9fe:a9fe'] },
    'public.test': { A: ['93.184.215.14'] },
    'both.test': { A: ['127.0.0.1'], AAAA: ['::1'] },
    'flip.test': { A: ['127.0.0.1'] },
    'dalaran.test': { A: ['127.0.0.1'] },
    'orgrimmar.test': { A: ['127.0.0.1'] },
    'scan.test': {
      A: Array.from({ length: 8 }, (_, i) => `192.0.2.${i + 1}`),
      AAAA: Array.from({ length: 8 }, (_, i) => `2001:db8::${i + 1}`),
    },
  });
  port = await listen(recorder, 0, '127.0.0.1');
  ipv6 = await listen(recorder6, port, '::1').then(
    () => true,
    () => false,
  );
  rawPort = await listen(raw, 0, '127.0.0.1');
  tlsPort = await listen(recorderTLS, 0, '127.0.0.1');
  subscribe('net.client.socket', recordDials);
});

after(async () => {
  unsubscribe('net.client.socket', recordDials);
  for (const server of [recorder, recorder6, recorderTLS]) {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
  raw.close();
  await dns.close();
});

describe('fetchPublic', () => {
  describe('the input URL', () => {
    it('fetches an allowed URL and reports its final URL, headers and declared size', async () => {
      const response = await open(local('/ok'), { allow: LOOPBACK });
      strictEqual(response.url.href, local('/ok'));
      strictEqual(response.headers.get('content-type'), 'text/plain');
      strictEqual(response.size, BODY.length);
      strictEqual(await text(response.body), BODY);
    });

    it('takes a URL object', async () => {
      const { body } = await open(new URL(local('/ok')), { allow: LOOPBACK });
      strictEqual(await text(body), BODY);
    });

    it('refuses anything but an http or https URL as invalid', async () => {
      const urls = [
        'Thrall',
        'http://[bad/',
        'http://arthas:frostmourne@[bad/',
        'file:///etc/passwd',
        'ftp://127.0.0.1/',
        'data:,Thrall',
        'javascript:alert(1)',
        'ws://127.0.0.1/',
      ];
      for (const url of urls) await fails(open(url, { allow: LOOPBACK }), 'invalid');
    });

    it('refuses userinfo as invalid, and never sends it', async () => {
      hits.length = 0;
      await fails(
        open(`http://arthas:frostmourne@127.0.0.1:${port}/ok`, { allow: LOOPBACK }),
        'invalid',
      );
      deepStrictEqual(hits, []);
    });

    it('fails an already aborted signal before any request', async () => {
      hits.length = 0;
      await fails(open(local('/ok'), { allow: LOOPBACK, signal: AbortSignal.abort() }), 'aborted');
      deepStrictEqual(hits, []);
    });
  });

  describe('literal addresses', () => {
    const forms = [
      '127.0.0.1',
      '[::1]',
      '[::ffff:7f00:1]',
      '[::ffff:127.0.0.1]',
      '0',
      '2130706433',
      '0x7f.1',
      '0177.0.0.1',
      '127.1',
      '[64:ff9b::7f00:1]',
    ];
    for (const host of forms) {
      it(`refuses ${host} on port 80 without dialing it`, () =>
        refusedUndialed(`http://${host}/secret`));
    }

    it('refuses a literal over https before any handshake', () =>
      refusedUndialed('https://127.0.0.1/secret'));

    it('refuses a public address on a port other than 80 and 443', () =>
      refusedUndialed('http://93.184.215.14:6379/'));

    it("refuses Azure's platform address although it is public", async () => {
      await refusedUndialed('http://168.63.129.16/');
      await refusedUndialed('http://[64:ff9b::a83f:8110]/');
    });

    it("refuses the host's own public address", { skip: !ownPublic }, () =>
      refusedUndialed(`http://${ownPublic?.includes(':') ? `[${ownPublic}]` : ownPublic}/`),
    );

    it('reaches an allowed address on any port', async () => {
      const { body } = await open(local('/ok'), { allow: ['127.0.0.0/8'] });
      strictEqual(await text(body), BODY);
    });

    it('reaches an allowed IPv6 address', async (t) => {
      if (!ipv6) return t.skip('no IPv6 loopback');
      const { body } = await open(`http://[::1]:${port}/ok`, { allow: ['::1'] });
      strictEqual(await text(body), BODY);
    });
  });

  describe('names', () => {
    it('refuses a name that resolves to loopback', () =>
      refusedUndialed('http://loop.test/secret'));

    it('refuses a name that resolves to cloud metadata', () =>
      refusedUndialed('http://meta.test/latest/meta-data/'));

    it('refuses the whole answer when one address in it is refused', () =>
      refusedUndialed('http://mixed.test/secret', { allow: ['127.0.0.1'] }));

    it('checks the AAAA answer alongside the A answer', () =>
      refusedUndialed('http://dual.test/secret', { allow: ['127.0.0.1'] }));

    it('refuses an AAAA answer inside unique local space', () =>
      refusedUndialed('http://imds6.test/'));

    it('refuses an IPv4-mapped loopback AAAA answer', () =>
      refusedUndialed('http://mapped.test/secret'));

    it('refuses a NAT64 metadata AAAA answer', () => refusedUndialed('http://nat64.test/'));

    it('refuses a public answer on a port other than 80 and 443', () =>
      refusedUndialed('http://public.test:6379/'));

    it('refuses a name over https before any handshake', () =>
      refusedUndialed('https://loop.test/secret'));

    it('reports a name without records as unreachable', () =>
      fails(open('http://nowhere.test/'), 'unreachable'));

    it('reaches an allowed name', async () => {
      const { body } = await open(`http://loop.test:${port}/ok`, { allow: ['127.0.0.0/8'] });
      strictEqual(await text(body), BODY);
    });

    it('never goes through an environment proxy, which would skip the lookup', async () => {
      let proxied = 0;
      const proxy = createServer((_, res) => {
        proxied++;
        res.writeHead(200, { 'content-length': 6 }).end('Medivh');
      });
      proxy.on('connect', (_, socket: Socket) => {
        proxied++;
        socket.destroy();
      });
      const origin = `http://127.0.0.1:${await listen(proxy, 0, '127.0.0.1')}`;
      const env = {
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: origin,
        HTTPS_PROXY: origin,
        NO_PROXY: '',
      };
      try {
        for (const url of ['http://loop.test/', 'https://loop.test/']) {
          strictEqual(await fetchInChild(url, { servers: dns.servers }, { env }), 'refused');
        }
        strictEqual(proxied, 0);
      } finally {
        proxy.close();
      }
    });

    it('dials at most one address per family, so a long answer is no port scan', async () => {
      const previous = getDefaultAutoSelectFamilyAttemptTimeout();
      const sockets: Socket[] = [];
      const onSocket = (message: unknown): void => {
        sockets.push((message as { socket: Socket }).socket);
      };
      setDefaultAutoSelectFamilyAttemptTimeout(10);
      subscribe('net.client.socket', onSocket);
      try {
        await rejects(
          open('http://scan.test/', { allow: ['192.0.2.0/24', '2001:db8::/32'], timeout: 500 }),
        );
        deepStrictEqual(
          sockets.map((socket) => socket.autoSelectFamilyAttemptedAddresses),
          [['192.0.2.1:80', '2001:db8::1:80']],
        );
      } finally {
        unsubscribe('net.client.socket', onSocket);
        setDefaultAutoSelectFamilyAttemptTimeout(previous);
      }
    });

    it('hands both families to happy eyeballs', async () => {
      const { body } = await open(`http://both.test:${port}/ok`, { allow: LOOPBACK });
      strictEqual(await text(body), BODY);
    });

    it('answers with a single address when happy eyeballs is off', async () => {
      const previous = getDefaultAutoSelectFamily();
      setDefaultAutoSelectFamily(false);
      try {
        const { body } = await open(`http://loop.test:${port}/ok`, { allow: LOOPBACK });
        strictEqual(await text(body), BODY);
      } finally {
        setDefaultAutoSelectFamily(previous);
      }
    });

    it('resolves again for every hop, so a rebinding name is caught on the next connection', async () => {
      dns.zone.set('flip.test', { A: ['127.0.0.1'] });
      dns.queries.length = 0;
      dials.length = 0;
      await fails(open(`http://flip.test:${port}/flip`, { allow: ['127.0.0.1'] }), 'refused');
      deepStrictEqual(dials, [`127.0.0.1:${port}`]);
      deepStrictEqual(
        dns.queries.filter((query) => query === 'A flip.test'),
        ['A flip.test', 'A flip.test'],
      );
    });

    it('stops waiting on a DNS server that never answers', async () => {
      const silent = createSocket('udp4');
      await new Promise<void>((resolve) => silent.bind(0, '127.0.0.1', resolve));
      const servers = [`127.0.0.1:${silent.address().port}`];
      try {
        const started = Date.now();
        await fails(open('http://silent.test/', { servers, timeout: 300 }), 'timeout');
        const signal = AbortSignal.timeout(300);
        await fails(open('http://silent.test/', { servers, signal }), 'aborted');
        ok(Date.now() - started < 2000);
      } finally {
        silent.close();
      }
    });
  });

  describe('redirects', () => {
    for (const status of [301, 302, 303, 307, 308]) {
      it(`follows a ${status} with a relative Location`, async () => {
        const response = await open(local(`/redirect?status=${status}&to=/ok`), {
          allow: LOOPBACK,
        });
        strictEqual(response.url.href, local('/ok'));
        strictEqual(await text(response.body), BODY);
      });
    }

    it('refuses a redirect to a refused address without dialing it', async () => {
      dials.length = 0;
      const to = 'http://[::1]/secret';
      await fails(open(local(`/redirect?to=${to}`), { allow: ['127.0.0.1'] }), 'refused');
      deepStrictEqual(dials, [`127.0.0.1:${port}`]);
    });

    it('refuses a redirect to a name that resolves to cloud metadata', () =>
      fails(open(local('/redirect?to=http://meta.test/'), { allow: LOOPBACK }), 'refused'));

    it('refuses a redirect to another scheme', () =>
      fails(open(local('/redirect?to=file:///etc/passwd'), { allow: LOOPBACK }), 'refused'));

    it('refuses a redirect carrying userinfo', async () => {
      hits.length = 0;
      const to = `http://arthas:frostmourne@127.0.0.1:${port}/ok`;
      await fails(open(local(`/redirect?to=${to}`), { allow: LOOPBACK }), 'refused');
      strictEqual(hits.length, 1);
    });

    it('refuses a drop from https to http', () => {
      const refused = (error: unknown): boolean =>
        isFetchPublicError(error) && error.code === 'refused';
      throws(() => nextHop('http://example.com/a.png', new URL('https://example.com/')), refused);
      strictEqual(
        nextHop('https://example.com/a.png', new URL('http://example.com/')).href,
        'https://example.com/a.png',
      );
    });

    it('reports a redirect without a usable Location as unreachable', async () => {
      await fails(open(local('/noloc'), { allow: LOOPBACK }), 'unreachable');
      await fails(open(local('/redirect?to=http://[bad'), { allow: LOOPBACK }), 'unreachable');
    });

    it("hangs up on a redirect's body instead of reading it", async () => {
      const gone = once(served, 'gone /flood');
      const { body } = await open(local('/flood'), { allow: LOOPBACK });
      strictEqual(await text(body), BODY);
      await gone;
    });

    it('stops after five redirects', async () => {
      hits.length = 0;
      await fails(open(local('/loop'), { allow: LOOPBACK }), 'redirects');
      strictEqual(hits.length, 6);
    });

    it('sends the same fixed headers on every hop, and nothing else', async () => {
      heads.length = 0;
      const { body } = await open(local('/redirect?to=/ok'), {
        allow: LOOPBACK,
        userAgent: 'Khadgar',
      });
      await text(body);
      const expected = {
        accept: '*/*',
        'accept-encoding': 'identity',
        'user-agent': 'Khadgar',
        host: `127.0.0.1:${port}`,
        connection: 'close',
      };
      deepStrictEqual(heads, [expected, expected]);
    });

    it('sends no User-Agent when none is given', async () => {
      heads.length = 0;
      await text((await open(local('/ok'), { allow: LOOPBACK })).body);
      strictEqual(heads[0]?.['user-agent'], undefined);
    });
  });

  describe('responses', () => {
    for (const code of [201, 204, 206, 300, 304, 404, 500]) {
      it(`refuses a final ${code}`, () =>
        fails(open(local(`/status?code=${code}`), { allow: LOOPBACK }), 'status', code));
    }

    it('refuses a Content-Encoding it did not ask for', () =>
      fails(open(local('/gzip'), { allow: LOOPBACK }), 'refused'));

    it('refuses a body delimited by the connection closing', () =>
      fails(open(rawLocal('/unframed'), { allow: LOOPBACK }), 'refused'));

    it('refuses a transfer coding other than chunked', () =>
      fails(open(rawLocal('/te-gzip'), { allow: LOOPBACK }), 'refused'));

    it('streams a chunked body, with no declared size', async () => {
      const response = await open(local('/chunked'), { allow: LOOPBACK });
      strictEqual(response.size, undefined);
      strictEqual(await text(response.body), BODY);
    });

    it('errors a body that arrives shorter than declared', async () => {
      const { body } = await open(rawLocal('/short'), { allow: LOOPBACK });
      await fails(text(body), 'unreachable');
    });

    it('survives bytes after the declared length', async () => {
      const { body } = await open(rawLocal('/overlong'), { allow: LOOPBACK });
      strictEqual(await text(body), 'Jaina');
      // The parse error on the trailing bytes lands after the body; give it a turn to crash.
      await delay(50);
    });

    it('settles an unsolicited 101 at once', async () => {
      const started = Date.now();
      await fails(open(rawLocal('/upgrade'), { allow: LOOPBACK }), 'unreachable');
      ok(Date.now() - started < 1000);
    });

    it('fails a head past 16 KiB', () =>
      fails(open(rawLocal('/bighead'), { allow: LOOPBACK }), 'unreachable'));

    it('keeps the 16 KiB head cap under --max-http-header-size', async () => {
      const flags = ['--max-http-header-size=65536'];
      strictEqual(
        await fetchInChild(rawLocal('/bighead'), { allow: LOOPBACK }, { flags }),
        'unreachable',
      );
    });

    it('keeps the strict parser under --insecure-http-parser', async () => {
      const flags = ['--insecure-http-parser'];
      strictEqual(
        await fetchInChild(rawLocal('/lf'), { allow: LOOPBACK }, { flags }),
        'unreachable',
      );
    });
  });

  describe('TLS', () => {
    it('refuses an untrusted certificate even with NODE_TLS_REJECT_UNAUTHORIZED=0', async () => {
      const url = `https://dalaran.test:${tlsPort}/ok`;
      const options = { allow: LOOPBACK, servers: dns.servers };
      const env = { NODE_TLS_REJECT_UNAUTHORIZED: '0' };
      strictEqual(await fetchInChild(url, options, { env }), 'unreachable');
    });

    it('verifies the certificate against the hostname, which it also sends as SNI', async () => {
      const trusted = getCACertificates('default');
      setDefaultCACertificates([...trusted, DALARAN_CERT]);
      try {
        sni.length = 0;
        const { body } = await open(`https://dalaran.test:${tlsPort}/ok`, { allow: LOOPBACK });
        strictEqual(await text(body), BODY);
        deepStrictEqual(sni, ['dalaran.test']);
        await fails(
          open(`https://orgrimmar.test:${tlsPort}/ok`, { allow: LOOPBACK }),
          'unreachable',
        );
        await fails(open(`https://127.0.0.1:${tlsPort}/ok`, { allow: LOOPBACK }), 'unreachable');
      } finally {
        setDefaultCACertificates(trusted);
      }
    });
  });

  describe('limits', () => {
    it('refuses a declared length past maxBytes before reading the body', () =>
      fails(open(local('/big'), { allow: LOOPBACK, maxBytes: 1024 }), 'tooLarge'));

    it('passes a body exactly at maxBytes', async () => {
      const { body } = await open(local('/ok'), { allow: LOOPBACK, maxBytes: BODY.length });
      strictEqual(await text(body), BODY);
    });

    it('errors a streamed body past maxBytes and hangs up', async () => {
      const gone = once(served, 'gone /endless');
      const { body } = await open(local('/endless'), { allow: LOOPBACK, maxBytes: 65_536 });
      await fails(text(body), 'tooLarge');
      await gone;
    });

    it('ends a dripping body at the total deadline', async () => {
      const started = Date.now();
      const { body } = await open(local('/drip'), { allow: LOOPBACK, timeout: 300 });
      await fails(text(body), 'timeout');
      ok(Date.now() - started < 2000);
    });

    it('ends a dripping head at the total deadline', () =>
      fails(open(rawLocal('/slowhead'), { allow: LOOPBACK, timeout: 300 }), 'timeout'));

    it(
      'ends a dripping head at the headers deadline, long before the total',
      { timeout: 5000 },
      async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const hit = once(served, 'hit /slowhead');
        const options = { allow: LOOPBACK, timeout: 600_000, signal: t.signal };
        const fetched = open(rawLocal('/slowhead'), options);
        await hit;
        t.mock.timers.tick(30_000);
        await fails(fetched, 'timeout');
      },
    );

    it('ends a body the remote falls silent on while it is read', { timeout: 5000 }, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const options = { allow: LOOPBACK, timeout: 600_000, signal: t.signal };
      const reader = (await open(local('/stall'), options)).body.getReader();
      strictEqual(new TextDecoder().decode((await reader.read()).value), 'Jaina');
      const next = reader.read();
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(30_000);
      await fails(next, 'timeout');
    });

    it(
      'keeps a body its reader pauses on longer than the idle timeout',
      { timeout: 5000 },
      async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const options = { allow: LOOPBACK, timeout: 600_000, signal: t.signal };
        const { body } = await open(local('/large'), options);
        const reader = body.getReader();
        let received = (await reader.read()).value?.byteLength ?? 0;
        // No pull may still wait on the remote at the tick, or the idle timeout would rightly fire.
        for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
        t.mock.timers.tick(31_000);
        reader.releaseLock();
        for await (const chunk of body) received += chunk.byteLength;
        strictEqual(received, LARGE);
      },
    );

    it('aborts mid-body through the signal and hangs up', async () => {
      const controller = new AbortController();
      const gone = once(served, 'gone /stall');
      const { body } = await open(local('/stall'), { allow: LOOPBACK, signal: controller.signal });
      const reader = body.getReader();
      strictEqual(new TextDecoder().decode((await reader.read()).value), 'Jaina');
      controller.abort();
      await fails(reader.read(), 'aborted');
      await gone;
    });

    it('aborts a request still waiting for its response', async () => {
      const gone = once(served, 'gone /hang');
      const signal = AbortSignal.timeout(100);
      await fails(open(local('/hang'), { allow: LOOPBACK, signal }), 'aborted');
      await gone;
    });

    it('hangs up when the body is cancelled unread', async () => {
      const gone = once(served, 'gone /stall');
      const { body } = await open(local('/stall'), { allow: LOOPBACK });
      await body.cancel();
      await gone;
    });
  });
});
