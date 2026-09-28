import { rejects, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { type Event, HTTPError, runWithEvent, sendFile } from '../../../src/ohne/index.ts';

function makeEvent(): Event {
  return {
    request: new Request('http://localhost/'),
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

  it('answers 404 for a path that can name no file', async () => {
    for (const path of ['scroll/page.txt/x', 'a\0b', 'x'.repeat(300)]) {
      await rejects(serve([first], path), isNotFound);
    }
  });
});
