import { doesNotMatch, match, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { createPrinter } from '../../../src/utils/print/index.ts';

const E = '\x1b';

function capture(opts: { color?: boolean; debug?: boolean; silent?: boolean } = {}) {
  const buf: string[] = [];
  const printer = createPrinter({
    color: opts.color ?? false,
    debug: opts.debug,
    silent: opts.silent,
    stream: { write: (s) => buf.push(s) },
  });
  return { printer, out: () => buf.join('') };
}

describe('createPrinter', () => {
  describe('single-line', () => {
    it('renders success with the head glyph and a trailing newline', () => {
      const { printer, out } = capture();
      printer.success('Done');
      strictEqual(out(), '●  Done\n');
    });

    it('renders info, warn, error, debug uniformly', () => {
      const { printer, out } = capture({ debug: true });
      printer.info('I');
      printer.warn('W');
      printer.error('E');
      printer.debug('D');
      strictEqual(out(), '●  I\n●  W\n●  E\n●  D\n');
    });

    it('trims surrounding whitespace from the message', () => {
      const { printer, out } = capture();
      printer.info('  hello  ');
      strictEqual(out(), '●  hello\n');
    });
  });

  describe('block - structure', () => {
    it('renders head, leading rail, body, and bare corner without path', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'Headline', body: 'line one' });
      strictEqual(out(), ['●  Headline', '│', '│  line one', '└', ''].join('\n'));
    });

    it('hard-wraps `\\n` inside a paragraph under one rail', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'a\nb\nc' });
      strictEqual(out(), ['●  H', '│', '│  a', '│  b', '│  c', '└', ''].join('\n'));
    });

    it('treats `\\n\\n` in a string body as a paragraph break', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'p1\n\np2' });
      strictEqual(out(), ['●  H', '│', '│  p1', '│', '│  p2', '└', ''].join('\n'));
    });

    it('treats each array entry as one paragraph', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: ['one', 'two'] });
      strictEqual(out(), ['●  H', '│', '│  one', '│', '│  two', '└', ''].join('\n'));
    });

    it('collapses triple-newline runs to a single paragraph break', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'p1\n\n\np2' });
      strictEqual(out(), ['●  H', '│', '│  p1', '│', '│  p2', '└', ''].join('\n'));
    });

    it('preserves internal indentation inside a paragraph', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'a\n  b' });
      strictEqual(out(), ['●  H', '│', '│  a', '│    b', '└', ''].join('\n'));
    });
  });

  describe('block - trimming', () => {
    it('trims outer whitespace from a string body', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: '\n\n  hello  \n\n' });
      strictEqual(out(), ['●  H', '│', '│  hello', '└', ''].join('\n'));
    });

    it('trims each array entry and drops empty entries', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: ['  hello  ', '   ', ''] });
      strictEqual(out(), ['●  H', '│', '│  hello', '└', ''].join('\n'));
    });

    it('trims the title', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: '  H  ', body: 'x' });
      strictEqual(out(), ['●  H', '│', '│  x', '└', ''].join('\n'));
    });
  });

  describe('block - path', () => {
    it('renders `└─ path` with a separating rail row before the corner', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'line', path: 'src/x.ts' });
      strictEqual(out(), ['●  H', '│', '│  line', '│', '└─ src/x.ts', ''].join('\n'));
    });

    it('renders empty body with path as head + bare rail + corner+path', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: '', path: 'src/x.ts' });
      strictEqual(out(), ['●  H', '│', '└─ src/x.ts', ''].join('\n'));
    });

    it('collapses empty body without path to the title line alone', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: '' });
      strictEqual(out(), '●  H\n');
    });

    it('treats whitespace-only path as absent', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'line', path: '   ' });
      strictEqual(out(), ['●  H', '│', '│  line', '└', ''].join('\n'));
    });

    it('trims surrounding whitespace from path', () => {
      const { printer, out } = capture();
      printer.infoBlock({ title: 'H', body: 'line', path: '  src/x.ts  ' });
      strictEqual(out(), ['●  H', '│', '│  line', '│', '└─ src/x.ts', ''].join('\n'));
    });

    it('renders path literally without applying inline markup', () => {
      const { printer, out } = capture({ color: true });
      printer.infoBlock({ title: 'H', body: 'line', path: 'src/__tests__/x.ts' });
      ok(out().includes('src/__tests__/x.ts'));
      doesNotMatch(out(), new RegExp(`${E}\\[2m`));
    });

    it('tints the dash and path in the level color', () => {
      const { printer, out } = capture({ color: true });
      printer.warnBlock({ title: 'H', body: 'line', path: 'src/x.ts' });
      match(out(), new RegExp(`${E}\\[33m└─ src/x\\.ts${E}\\[39m`));
    });
  });

  describe('block - error tinting', () => {
    it('red-tints the title in errorBlock; body markup processes as cyan', () => {
      const { printer, out } = capture({ color: true });
      printer.errorBlock({ title: 'boom', body: 'detail `foo` body' });
      match(out(), new RegExp(`${E}\\[31m.*boom.*${E}\\[39m`));
      match(out(), new RegExp(`${E}\\[96mfoo${E}\\[39m`));
    });

    it('tints the corner+path in red for errorBlock', () => {
      const { printer, out } = capture({ color: true });
      printer.errorBlock({ title: 'H', body: 'line', path: 'src/x.ts' });
      match(out(), new RegExp(`${E}\\[31m└─ src/x\\.ts${E}\\[39m`));
    });
  });

  describe('block - warn tinting', () => {
    it('yellow-tints the title in warnBlock; body markup processes as cyan', () => {
      const { printer, out } = capture({ color: true });
      printer.warnBlock({ title: 'careful', body: 'detail `foo` body' });
      match(out(), new RegExp(`${E}\\[33m.*careful.*${E}\\[39m`));
      match(out(), new RegExp(`${E}\\[96mfoo${E}\\[39m`));
    });
  });

  describe('block - debug tinting', () => {
    it('dims the title in debugBlock', () => {
      const { printer, out } = capture({ color: true, debug: true });
      printer.debugBlock({ title: 'span', body: 'x' });
      match(out(), new RegExp(`${E}\\[2mspan${E}\\[22m`));
    });

    it('keeps the head and corner gray, not dim', () => {
      const { printer, out } = capture({ color: true, debug: true });
      printer.debugBlock({ title: 'span', body: 'x' });
      match(out(), new RegExp(`${E}\\[90m●${E}\\[39m`));
      match(out(), new RegExp(`${E}\\[90m└${E}\\[39m`));
    });
  });

  describe('inline markup', () => {
    it('strips and styles a backtick span as cyan in non-error single-line', () => {
      const { printer, out } = capture({ color: true });
      printer.info('open `foo` close');
      ok(!out().includes('`foo`'));
      match(out(), new RegExp(`${E}\\[96mfoo${E}\\[39m`));
    });

    it('renders a backtick span as bold inside error single-line (not cyan)', () => {
      const { printer, out } = capture({ color: true });
      printer.error('bad `thing` found');
      match(out(), new RegExp(`${E}\\[1mthing${E}\\[22m`));
      doesNotMatch(out(), new RegExp(`${E}\\[96mthing${E}\\[39m`));
    });

    it('strips and styles `**bold**` as bold', () => {
      const { printer, out } = capture({ color: true });
      printer.info('see **here**');
      match(out(), new RegExp(`${E}\\[1mhere${E}\\[22m`));
    });

    it('strips and styles `__dim__` as dim', () => {
      const { printer, out } = capture({ color: true });
      printer.info('path __./foo__ done');
      match(out(), new RegExp(`${E}\\[2m\\./foo${E}\\[22m`));
    });

    it('leaves `table__name` literal (word-boundary aware)', () => {
      const { printer, out } = capture({ color: true });
      printer.info('table__name unchanged');
      ok(out().includes('table__name'));
      doesNotMatch(out(), new RegExp(`${E}\\[2m`));
    });

    it('leaves `table__name__suffix` literal (boundaries on both sides)', () => {
      const { printer, out } = capture({ color: true });
      printer.info('table__name__suffix unchanged');
      ok(out().includes('table__name__suffix'));
      doesNotMatch(out(), new RegExp(`${E}\\[2m`));
    });

    it('tints the entire error single-line red', () => {
      const { printer, out } = capture({ color: true });
      printer.error('boom');
      match(out(), new RegExp(`${E}\\[31m.*boom.*${E}\\[39m`));
    });

    it('does not red-tint non-error single-line', () => {
      const { printer, out } = capture({ color: true });
      printer.success('Done');
      doesNotMatch(out(), new RegExp(`${E}\\[31m`));
    });

    it('does not tint the message body for non-error single-lines', () => {
      const { printer, out } = capture({ color: true, debug: true });
      printer.success('s');
      printer.info('i');
      printer.warn('w');
      printer.debug('d');
      const o = out();
      ok(o.includes(`●${E}[39m  s\n`));
      ok(o.includes(`●${E}[39m  i\n`));
      ok(o.includes(`●${E}[39m  w\n`));
      ok(o.includes(`●${E}[39m  d\n`));
    });

    it('colors head, rail, and corner with the level tint in blocks', () => {
      const { printer, out } = capture({ color: true });
      printer.warnBlock({ title: 'H', body: 'x' });
      match(out(), new RegExp(`${E}\\[33m●${E}\\[39m`));
      match(out(), new RegExp(`${E}\\[33m│${E}\\[39m`));
      match(out(), new RegExp(`${E}\\[33m└${E}\\[39m`));
    });
  });

  describe('control characters', () => {
    it('spells them out in a line', () => {
      const { printer, out } = capture();
      printer.warn('a\x1b[2Jb\rc\x9b');
      strictEqual(out(), '●  a\\x1B[2Jb\\rc\\x9B\n');
    });

    it('hangs each later line of a message under the text, so none starts at the glyph', () => {
      const { printer, out } = capture({ debug: true });
      printer.warn('unlink x\n●  Deleted 0 stray files');
      printer.debug('stack\n    at x\x07');
      strictEqual(out(), '●  unlink x\n   ●  Deleted 0 stray files\n●  stack\n       at x\\x07\n');
    });

    it('spells them out in the title, every body row, and the path', () => {
      const { printer, out } = capture();
      printer.errorBlock({ title: 'T\x1b[1A', body: 'x\r● ok\ny\b', path: 'a\x1b]8;;u\x07b' });
      strictEqual(
        out(),
        ['●  T\\x1B[1A', '│', '│  x\\r● ok', '│  y\\b', '│', '└─ a\\x1B]8;;u\\x07b', ''].join('\n'),
      );
    });

    it('still styles markup around the escapes', () => {
      const { printer, out } = capture({ color: true });
      printer.info('got `a\x1bb`');
      strictEqual(out(), `${E}[96m●${E}[39m  got ${E}[96ma\\x1Bb${E}[39m\n`);
    });
  });

  describe('color toggle', () => {
    it('strips all ANSI when color is false', () => {
      const { printer, out } = capture({ color: false });
      printer.errorBlock({ title: 'bad "thing"', body: '__dim__', path: 'src/x.ts' });
      doesNotMatch(out(), new RegExp(`${E}\\[`));
    });

    it('emits ANSI when color is true regardless of TTY', () => {
      const { printer, out } = capture({ color: true });
      printer.success('Done');
      match(out(), new RegExp(`${E}\\[`));
    });
  });

  describe('debug gating', () => {
    it('drops debug single-line by default', () => {
      const { printer, out } = capture();
      printer.debug('hidden');
      strictEqual(out(), '');
    });

    it('drops debugBlock by default', () => {
      const { printer, out } = capture();
      printer.debugBlock({ title: 'H', body: 'x' });
      strictEqual(out(), '');
    });

    it('emits debug single-line when enabled', () => {
      const { printer, out } = capture({ debug: true });
      printer.debug('shown');
      strictEqual(out(), '●  shown\n');
    });

    it('emits debugBlock when enabled', () => {
      const { printer, out } = capture({ debug: true });
      printer.debugBlock({ title: 'H', body: 'x' });
      strictEqual(out(), ['●  H', '│', '│  x', '└', ''].join('\n'));
    });
  });

  describe('silent', () => {
    it('drops every single-line and block call when silent', () => {
      const { printer, out } = capture({ silent: true, debug: true });
      printer.success('s');
      printer.info('i');
      printer.warn('w');
      printer.error('e');
      printer.debug('d');
      printer.successBlock({ title: 's', body: 'x' });
      printer.errorBlock({ title: 'e', body: 'x', path: 'p' });
      strictEqual(out(), '');
    });
  });

  describe('configure', () => {
    it('toggles silent in place', () => {
      const { printer, out } = capture();
      printer.info('first');
      printer.configure({ silent: true });
      printer.info('hidden');
      printer.configure({ silent: false });
      printer.info('third');
      strictEqual(out(), '●  first\n●  third\n');
    });

    it('toggles debug in place', () => {
      const { printer, out } = capture();
      printer.debug('hidden');
      printer.configure({ debug: true });
      printer.debug('shown');
      strictEqual(out(), '●  shown\n');
    });

    it('swaps the stream', () => {
      const buf2: string[] = [];
      const { printer, out } = capture();
      printer.info('to first');
      printer.configure({ stream: { write: (s) => buf2.push(s) } });
      printer.info('to second');
      strictEqual(out(), '●  to first\n');
      strictEqual(buf2.join(''), '●  to second\n');
    });

    it('flips color on and off', () => {
      const { printer, out } = capture({ color: false });
      printer.info('plain');
      printer.configure({ color: true });
      printer.info('`styled`');
      ok(out().includes('●  plain\n'));
      match(out(), new RegExp(`${E}\\[96mstyled${E}\\[39m`));
    });
  });

  describe('color detection', () => {
    it('emits ANSI when the stream is a TTY', () => {
      const buf: string[] = [];
      const printer = createPrinter({ stream: { write: (s) => buf.push(s), isTTY: true } });
      printer.success('x');
      ok(buf.join('').includes(`${E}[`));
    });

    it('strips ANSI when the stream is not a TTY', () => {
      const buf: string[] = [];
      const printer = createPrinter({ stream: { write: (s) => buf.push(s) } });
      printer.success('x');
      ok(!buf.join('').includes(`${E}[`));
    });

    it('honors an explicit `color: true` override even without a TTY', () => {
      const buf: string[] = [];
      const printer = createPrinter({ color: true, stream: { write: (s) => buf.push(s) } });
      printer.success('x');
      ok(buf.join('').includes(`${E}[`));
    });

    it('honors an explicit `color: false` override on a TTY', () => {
      const buf: string[] = [];
      const printer = createPrinter({
        color: false,
        stream: { write: (s) => buf.push(s), isTTY: true },
      });
      printer.success('x');
      ok(!buf.join('').includes(`${E}[`));
    });
  });
});
