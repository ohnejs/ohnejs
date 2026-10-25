import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { readTar } from '../../../src/utils/index.ts';
import { pax, tar } from './_tar.ts';

const text = (data: Uint8Array): string => new TextDecoder().decode(data);

describe('readTar', () => {
  it('reads files and directories with their bytes', () => {
    const entries = readTar(
      tar({ name: 'repo/', type: '5' }, { name: 'repo/README.md', data: '# Hi\n' }),
    );

    deepStrictEqual(
      entries.map(({ path, type }) => ({ path, type })),
      [
        { path: 'repo', type: 'directory' },
        { path: 'repo/README.md', type: 'file' },
      ],
    );
    strictEqual(entries[0]!.data.length, 0);
    strictEqual(text(entries[1]!.data), '# Hi\n');
  });

  it('reads data that spans several blocks', () => {
    const data = 'x'.repeat(1300);
    const [file, next] = readTar(tar({ name: 'big.txt', data }, { name: 'after.txt', data: 'a' }));

    strictEqual(text(file!.data), data);
    strictEqual(text(next!.data), 'a');
  });

  it('joins the ustar `prefix` to the name', () => {
    const prefix = `repo/${'deep/'.repeat(25)}end`;
    const [file] = readTar(tar({ name: 'file.ts', prefix, data: '1' }));

    strictEqual(file!.path, `${prefix}/file.ts`);
  });

  it('reads no `prefix` from a GNU header, whose bytes there mean something else', () => {
    const [file] = readTar(tar({ name: 'file.ts', prefix: 'ignored', gnu: true }));

    strictEqual(file!.path, 'file.ts');
  });

  it('takes the path and size from a pax header', () => {
    const long = `repo/${'a'.repeat(200)}/file.ts`;
    const entries = readTar(
      tar(
        pax({ path: long, size: '4' }),
        { name: 'short', data: 'body', size: 0 },
        { name: 'next' },
      ),
    );

    deepStrictEqual(
      entries.map(({ path }) => path),
      [long, 'next'],
    );
    strictEqual(text(entries[0]!.data), 'body');
  });

  it('skips a pax global header', () => {
    const entries = readTar(
      tar(pax({ comment: 'f00ba4' }, 'g'), { name: 'repo/a.txt', data: 'a' }),
    );

    deepStrictEqual(
      entries.map(({ path }) => path),
      ['repo/a.txt'],
    );
  });

  it('reads an empty archive', () => {
    deepStrictEqual(readTar(tar()), []);
  });

  it('refuses links and devices', () => {
    for (const type of ['1', '2', '3', '4', '6']) {
      throws(() => readTar(tar({ name: 'repo/link', type })), /unsupported type/, type);
    }
  });

  it('refuses absolute paths and `..` segments', () => {
    const names = ['/etc/passwd', 'repo/../../x', '..', 'a\\..\\b', 'C:/x', '\\x'];
    for (const name of names) {
      throws(() => readTar(tar({ name, data: 'x' })), /is unsafe/, name);
    }
    throws(() => readTar(tar(pax({ path: '../x' }), { name: 'safe', data: 'x' })), /is unsafe/);
  });

  it('shows an unsafe path exactly', () => {
    throws(() => readTar(tar(pax({ path: '/a`b\x1b[31m' }), { name: 'safe', data: 'x' })), {
      message: 'Tar entry path ``/a`b\\x1B[31m`` is unsafe',
    });
  });

  it('refuses a truncated archive', () => {
    const bytes = tar({ name: 'repo/a.txt', data: 'x'.repeat(600) });

    throws(() => readTar(bytes.subarray(0, 300)), /Truncated/);
    throws(() => readTar(bytes.subarray(0, 512 + 100)), /Truncated/);
    throws(() => readTar(bytes.subarray(0, 512 * 3)), /Truncated/);
  });

  it('refuses a header whose checksum does not match', () => {
    const bytes = tar({ name: 'repo/a.txt', data: 'x' });
    bytes[0] = 'b'.charCodeAt(0);

    throws(() => readTar(bytes), /checksum/);
  });

  it('refuses a malformed pax header', () => {
    const bad = { name: 'PaxHeader', type: 'x', data: '99 path=x\n' };

    throws(() => readTar(tar(bad, { name: 'a' })), /Malformed pax header/);
  });
});
