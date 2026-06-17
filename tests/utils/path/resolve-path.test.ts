import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { joinPath, resolvePath } from '../../../src/utils/index.ts';

describe('resolvePath', () => {
  it('normalizes an absolute path and ignores the base', () => {
    strictEqual(resolvePath('/srv/app', '/ignored'), '/srv/app');
    strictEqual(resolvePath('/srv/../srv/app'), '/srv/app');
  });

  it('joins a relative path onto the base', () => {
    strictEqual(resolvePath('src/index.ts', '/a'), '/a/src/index.ts');
    strictEqual(resolvePath('a/../b', '/root'), '/root/b');
  });

  it('defaults the base to the current working directory', () => {
    strictEqual(resolvePath('pkg/file.ts'), joinPath(process.cwd(), 'pkg/file.ts'));
  });

  it('preserves a Windows drive root', () => {
    strictEqual(resolvePath('C:\\app\\..\\lib'), 'C:/lib');
  });
});
