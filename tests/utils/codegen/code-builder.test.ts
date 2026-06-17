import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createCodeBuilder } from '../../../src/utils/codegen/index.ts';

describe('createCodeBuilder', () => {
  it('returns an empty string when nothing is appended', () => {
    strictEqual(createCodeBuilder().toString(), '');
  });

  it('joins lines with a trailing newline', () => {
    const c = createCodeBuilder();
    c.line('a');
    c.line('b');
    strictEqual(c.toString(), 'a\nb\n');
  });

  it('indents within a callback and restores after', () => {
    const c = createCodeBuilder();
    c.line('{');
    c.indent(() => c.line('inner'));
    c.line('}');
    strictEqual(c.toString(), '{\n  inner\n}\n');
  });

  it('nests indentation', () => {
    const c = createCodeBuilder();
    c.indent(() => c.indent(() => c.line('deep')));
    strictEqual(c.toString(), '    deep\n');
  });

  it('appends a blank line for empty text', () => {
    const c = createCodeBuilder();
    c.line('a');
    c.line();
    c.line('b');
    strictEqual(c.toString(), 'a\n\nb\n');
  });

  it('indents each line of multi-line text but keeps blanks blank', () => {
    const c = createCodeBuilder();
    c.indent(() => c.line('a\n\nb'));
    strictEqual(c.toString(), '  a\n\n  b\n');
  });

  it('appends many lines at once', () => {
    const c = createCodeBuilder();
    c.indent(() => c.lines(['a', 'b']));
    strictEqual(c.toString(), '  a\n  b\n');
  });

  it('respects a custom indent size', () => {
    const c = createCodeBuilder({ size: 4 });
    c.indent(() => c.line('x'));
    strictEqual(c.toString(), '    x\n');
  });

  it('chains', () => {
    const c = createCodeBuilder();
    c.line('a').line('b');
    strictEqual(c.toString(), 'a\nb\n');
  });
});
