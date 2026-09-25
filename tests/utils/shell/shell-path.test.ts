import { strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { shellPath } from '../../../src/utils/index.ts';

const NAMES = ['my app', "it's", 'a$b', 'a!b', 'a*b', 'we`ird', '~x', '#x', '-', '+1', 'ünï'];

describe('shellPath', () => {
  it('leaves a path of letters, digits, `_`, `.`, `/`, and `-` bare', () => {
    strictEqual(shellPath('../apps/my-app_v2.1'), '../apps/my-app_v2.1');
    strictEqual(shellPath('čevapi/ünï'), 'čevapi/ünï');
  });

  it('single-quotes a path with any other character', () => {
    strictEqual(shellPath('my app'), "'my app'");
    strictEqual(shellPath('~/a$b;c'), "'~/a$b;c'");
  });

  it('writes an apostrophe as a quoted escape', () => {
    strictEqual(shellPath("it's"), "'it'\\''s'");
  });

  it('prefixes a leading dash or plus with `./`', () => {
    strictEqual(shellPath('-dash'), './-dash');
    strictEqual(shellPath('+1'), "'./+1'");
  });

  it('quotes an empty path', () => {
    strictEqual(shellPath(''), "''");
  });

  it('sends `cd` in `sh` to exactly that directory', { skip: process.platform === 'win32' }, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'shell-path-')));
    try {
      for (const name of NAMES) mkdirSync(join(root, name));
      for (const name of NAMES) {
        const pwd = execFileSync('sh', ['-c', `cd ${shellPath(name)} && pwd -P`], { cwd: root });
        strictEqual(String(pwd), `${join(root, name)}\n`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
