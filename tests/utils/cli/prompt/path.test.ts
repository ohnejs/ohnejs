import { strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { createPrompt, isCancel, type PathOptions } from '../../../../src/utils/cli/index.ts';
import { joinPath } from '../../../../src/utils/path/join-path.ts';

let root: string;

before(() => {
  root = mkdtempSync(joinPath(tmpdir(), 'ohne-path-'));
  mkdirSync(joinPath(root, 'src'));
  mkdirSync(joinPath(root, 'docs'));
  mkdirSync(joinPath(root, '.config'));
  writeFileSync(joinPath(root, 'src', 'index.ts'), '');
  writeFileSync(joinPath(root, 'src', 'app.tsx'), '');
  writeFileSync(joinPath(root, 'src', 'util.js'), '');
  writeFileSync(joinPath(root, 'readme.md'), '');
  writeFileSync(joinPath(root, '.hidden'), '');
  writeFileSync(joinPath(root, 'docs', 'ok.md'), '');
  writeFileSync(joinPath(root, 'docs', 'a\x1b[2Jb.md'), '');
  writeFileSync(joinPath(root, 'docs', 'c\u009bd.md'), '');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

async function runPath(script: string[], options: Partial<PathOptions> = {}) {
  const input = new PassThrough();
  const out: string[] = [];
  const prompt = createPrompt({ input, output: { write: (s) => out.push(s) } });
  const result = prompt.path({ message: 'Path?', root, ...options });
  for (const chunk of script) input.write(chunk);
  return { result: await result, out };
}

describe('createPrompt().path', () => {
  it('resolves the typed path against root on Enter', async () => {
    const { result } = await runPath([...'readme.md', '\r']);
    strictEqual(result, joinPath(root, 'readme.md'));
  });

  it('completes a directory with Tab, appending a slash and descending', async () => {
    const { result } = await runPath([...'sr', '\t', '\r']);
    strictEqual(result, joinPath(root, 'src'));
  });

  it('completes a file with Tab without a trailing slash', async () => {
    const { result } = await runPath([...'read', '\t', '\r']);
    strictEqual(result, joinPath(root, 'readme.md'));
  });

  it('lists the children of a directory after descending into it', async () => {
    const { out } = await runPath([...'src/', '\x03']);
    const frame = out.join('');
    strictEqual(frame.includes('index.ts'), true);
    strictEqual(frame.includes('app.tsx'), true);
  });

  it('moves the highlight with the arrows and fills it with Tab', async () => {
    const { result } = await runPath(['\x1b[B', '\t', '\r']);
    strictEqual(result, joinPath(root, 'src'));
  });

  it('never offers a name holding a control character', async () => {
    const frame = (await runPath([...'docs/', '\x03'])).out.join('');
    strictEqual(frame.includes('ok.md'), true);
    strictEqual(frame.includes('a\x1b[2Jb'), false);
    strictEqual(frame.includes('c\u009bd'), false);
  });

  it('restricts file completions to the given extensions', async () => {
    const { out } = await runPath([...'src/', '\x03'], { ext: 'ts' });
    const frame = out.join('');
    strictEqual(frame.includes('index.ts'), true);
    strictEqual(frame.includes('app.tsx'), false);
    strictEqual(frame.includes('util.js'), false);
  });

  it('applies the filter predicate to files', async () => {
    const { out } = await runPath([...'src/', '\x03'], {
      filter: (entry) => entry.name.startsWith('index'),
    });
    const frame = out.join('');
    strictEqual(frame.includes('index.ts'), true);
    strictEqual(frame.includes('app.tsx'), false);
  });

  it('hides files when only directories are allowed', async () => {
    const { out } = await runPath(['\x03'], { only: 'directory' });
    const frame = out.join('');
    strictEqual(frame.includes('src/'), true);
    strictEqual(frame.includes('readme.md'), false);
  });

  it('rejects submitting a directory when only files are allowed', async () => {
    const { result, out } = await runPath([...'src', '\r', '\x15', ...'readme.md', '\r'], {
      only: 'file',
    });
    strictEqual(out.join('').includes('Select a file.'), true);
    strictEqual(result, joinPath(root, 'readme.md'));
  });

  it('rejects a path that does not exist when mustExist is set', async () => {
    const { result, out } = await runPath([...'nope.txt', '\r', '\x15', ...'readme.md', '\r'], {
      mustExist: true,
    });
    strictEqual(out.join('').includes('Path does not exist.'), true);
    strictEqual(result, joinPath(root, 'readme.md'));
  });

  it('returns a normalized relative path when absolute is false', async () => {
    const { result } = await runPath([...'./src', '\r'], { absolute: false });
    strictEqual(result, 'src');
  });

  it('hides dotfiles by default', async () => {
    const { out } = await runPath(['\x03']);
    strictEqual(out.join('').includes('.hidden'), false);
  });

  it('reveals dotfiles once the fragment starts with a dot', async () => {
    const { out } = await runPath([...'.', '\x03']);
    const frame = out.join('');
    strictEqual(frame.includes('.config'), true);
    strictEqual(frame.includes('.hidden'), true);
  });

  it('runs validate against the resolved value', async () => {
    const seen: string[] = [];
    const { result } = await runPath([...'readme.md', '\r'], {
      validate: (value) => void seen.push(value),
    });
    strictEqual(result, joinPath(root, 'readme.md'));
    strictEqual(seen[0], joinPath(root, 'readme.md'));
  });

  it('deletes back to the previous separator with Ctrl+W', async () => {
    const { result } = await runPath([...'a/b/c', '\x17', '\r'], { absolute: false });
    strictEqual(result, 'a/b');
  });

  it('trims surrounding whitespace from the submitted path', async () => {
    const { result } = await runPath([...' readme.md ', '\r']);
    strictEqual(result, joinPath(root, 'readme.md'));
  });

  it('ignores a space typed right after a separator', async () => {
    const { result } = await runPath([...'a/ b', '\r'], { absolute: false });
    strictEqual(result, 'a/b');
  });

  it('trims whitespace before a typed separator', async () => {
    const { result } = await runPath([...'a /b', '\r'], { absolute: false });
    strictEqual(result, 'a/b');
  });

  it(
    'reads a leading `~` as the home directory',
    { skip: process.platform === 'win32' },
    async () => {
      const home = process.env.HOME;
      process.env.HOME = root;
      try {
        const { result } = await runPath([...'~/sr', '\t', '\r'], { root: tmpdir() });
        strictEqual(result, joinPath(root, 'src'));
      } finally {
        process.env.HOME = home;
      }
    },
  );

  it('completes a directory literally named `~` as itself, never the home directory', async () => {
    const home = process.env.HOME;
    const local = joinPath(root, 'tilde');
    mkdirSync(joinPath(local, '~', 'inner'), { recursive: true });
    process.env.HOME = joinPath(root, 'src');
    try {
      const { result } = await runPath([...'~', '\t', '\r'], { root: local, only: 'directory' });
      strictEqual(result, joinPath(local, '~'));
    } finally {
      process.env.HOME = home;
    }
  });

  it('cancels on Ctrl-C', async () => {
    const { result } = await runPath([...'src', '\x03']);
    strictEqual(isCancel(result), true);
  });
});
