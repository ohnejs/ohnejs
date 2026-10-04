import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { codeFences } from '../../../src/utils/index.ts';

describe('codeFences', () => {
  it('finds a backtick fence with its info string', () => {
    const [fence] = codeFences('Intro\n\n```json files\n{ "a": 1 }\n```\n');
    strictEqual(fence?.info, 'json files');
    strictEqual(fence?.body, '{ "a": 1 }');
  });

  it('finds tilde fences', () => {
    deepStrictEqual(
      codeFences('~~~js\nlet a = 1\n~~~').map((fence) => fence.body),
      ['let a = 1'],
    );
  });

  it('lists every fence in order', () => {
    const fences = codeFences('```ts\na\n```\n\ntext\n\n```sh\nb\nc\n```\n');
    deepStrictEqual(
      fences.map(({ info, body }) => ({ info, body })),
      [
        { info: 'ts', body: 'a' },
        { info: 'sh', body: 'b\nc' },
      ],
    );
  });

  it('reports offsets that splice the body and keep both fences', () => {
    const source = 'x\n```json\n{}\n```\ny\n';
    const [fence] = codeFences(source);
    strictEqual(source.slice(fence!.start, fence!.end), '{}');
    strictEqual(
      source.slice(0, fence!.start) + '{\n  "b": 2\n}' + source.slice(fence!.end),
      'x\n```json\n{\n  "b": 2\n}\n```\ny\n',
    );
  });

  it('gives an empty fence an empty body at the closing fence', () => {
    const source = '```\n```\n';
    deepStrictEqual(codeFences(source), [{ info: '', body: '', start: 4, end: 4 }]);
  });

  it('keeps a shorter or different fence inside the body', () => {
    const source = '````md\n```js\nx\n```\n~~~\n````\n';
    deepStrictEqual(
      codeFences(source).map((fence) => fence.body),
      ['```js\nx\n```\n~~~'],
    );
  });

  it('does not close on a fence that carries an info string', () => {
    deepStrictEqual(
      codeFences('```\na\n```js\nb\n```').map((fence) => fence.body),
      ['a\n```js\nb'],
    );
  });

  it('ignores a backtick fence whose info string holds a backtick', () => {
    deepStrictEqual(codeFences('```a`b\ncode\n'), []);
  });

  it('accepts up to three spaces of indent', () => {
    strictEqual(codeFences('   ```\na\n   ```').length, 1);
    strictEqual(codeFences('    ```\na\n    ```').length, 0);
  });

  it('runs an unclosed fence to the end of the document', () => {
    deepStrictEqual(codeFences('```sh\necho hi\n'), [
      { info: 'sh', body: 'echo hi\n', start: 6, end: 14 },
    ]);
    deepStrictEqual(codeFences('```sh'), [{ info: 'sh', body: '', start: 5, end: 5 }]);
  });

  it('returns nothing for a document without fences', () => {
    deepStrictEqual(codeFences('Just `inline` code.'), []);
  });
});
