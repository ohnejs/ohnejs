import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createCode } from '../../../src/utils/codegen/index.ts';

describe('createCode', () => {
  it('returns an empty string when nothing is appended', () => {
    strictEqual(createCode().toString(), '');
  });

  it('joins lines with a trailing newline', () => {
    const c = createCode();
    c.line('a');
    c.line('b');
    strictEqual(c.toString(), 'a\nb\n');
  });

  it('indents within a callback and restores after', () => {
    const c = createCode();
    c.line('{');
    c.indent(() => c.line('inner'));
    c.line('}');
    strictEqual(c.toString(), '{\n  inner\n}\n');
  });

  it('nests indentation', () => {
    const c = createCode();
    c.indent(() => c.indent(() => c.line('deep')));
    strictEqual(c.toString(), '    deep\n');
  });

  it('appends a blank line for empty text', () => {
    const c = createCode();
    c.line('a');
    c.line();
    c.line('b');
    strictEqual(c.toString(), 'a\n\nb\n');
  });

  it('indents each line of multi-line text but keeps blanks blank', () => {
    const c = createCode();
    c.indent(() => c.line('a\n\nb'));
    strictEqual(c.toString(), '  a\n\n  b\n');
  });

  it('appends many lines at once', () => {
    const c = createCode();
    c.indent(() => c.lines(['a', 'b']));
    strictEqual(c.toString(), '  a\n  b\n');
  });

  it('respects a custom indent size', () => {
    const c = createCode({ size: 4 });
    c.indent(() => c.line('x'));
    strictEqual(c.toString(), '    x\n');
  });

  it('chains', () => {
    const c = createCode();
    c.line('a').line('b');
    strictEqual(c.toString(), 'a\nb\n');
  });
});
