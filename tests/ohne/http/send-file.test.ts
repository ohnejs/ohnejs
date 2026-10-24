import { match, rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type Event, HTTPError, runWithEvent, sendFile } from '../../../src/ohne/index.ts';

function makeEvent(headers: Record<string, string> = {}): Event {
  return {
    request: new Request('http://localhost/', { headers }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

async function serve(roots: string[], path: string): Promise<string> {
  const body = await runWithEvent(makeEvent(), () => sendFile(roots, path));
  return new TextDecoder().decode(body as Uint8Array);
}

function isNotFound(error: unknown): boolean {
  return error instanceof HTTPError && error.status === 404;
}

describe('sendFile', () => {
  let dir: string;
  let first: string;
  let second: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohne-send-file-'));
    first = join(dir, 'first');
    second = join(dir, 'second');
    mkdirSync(first);
    mkdirSync(join(second, 'scroll'), { recursive: true });
    writeFileSync(join(first, 'scroll'), 'Medivh');
    writeFileSync(join(second, 'scroll', 'page.txt'), 'Khadgar');
    writeFileSync(join(first, 'spell.ts'), 'export const school: string = "Frost";\n');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the file from the first root that holds it', async () => {
    strictEqual(await serve([first, second], 'scroll'), 'Medivh');
  });

  it('passes a root where a file stands in the path, serving a later root', async () => {
    strictEqual(await serve([first, second], 'scroll/page.txt'), 'Khadgar');
  });

  it('strips a module and has it revalidated against a weak stat ETag', async () => {
    const event = makeEvent();
    const body = await runWithEvent(event, () => sendFile([first], 'spell.ts'));
    strictEqual(body, 'export const school         = "Frost";\n');
    strictEqual(event.response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    strictEqual(event.response.headers.get('cache-control'), 'no-cache');
    match(event.response.headers.get('etag') ?? '', /^W\//);

    const fresh = makeEvent({ 'if-none-match': event.response.headers.get('etag') ?? '' });
    strictEqual(await runWithEvent(fresh, () => sendFile([first], 'spell.ts')), undefined);
    strictEqual(fresh.response.status, 304);
  });

  it('answers 404 for a path that can name no file', async () => {
    for (const path of ['scroll/page.txt/x', 'a\0b', 'x'.repeat(300)]) {
      await rejects(serve([first], path), isNotFound);
    }
  });
});
