import { ok, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { useEnv, useLayers, usePrinter } from 'ohne';

function capture(): string[] {
  const buf: string[] = [];
  useEnv().set('NO_COLOR', false);
  useEnv().set('FORCE_COLOR', undefined);
  usePrinter().configure({ stream: { write: (s: string) => buf.push(s) }, color: false });
  return buf;
}

describe('usePrinter', () => {
  let buf: string[];

  beforeEach(() => {
    buf = capture();
  });

  afterEach(() => {
    for (const layer of useLayers().layers()) {
      if (layer.path.startsWith('/test-printer-')) useLayers().remove(layer.path);
    }
    useEnv().unset('SILENT');
    useEnv().unset('DEBUG');
    useEnv().unset('NO_COLOR');
    useEnv().unset('FORCE_COLOR');
    useEnv().fill({});
  });

  it('drops debug calls when no layer enables it', () => {
    usePrinter().debug('hidden');
    strictEqual(buf.join(''), '');
  });

  it('emits debug after a layer sets `printer.debug` to `true`', () => {
    usePrinter().debug('before');
    strictEqual(buf.join(''), '');

    useLayers().add({ path: '/test-printer-debug', input: { printer: { debug: true } } });
    usePrinter().debug('after');
    strictEqual(buf.join(''), '●  after\n');
  });

  it('drops every call after a layer sets `printer.silent` to `true`', () => {
    usePrinter().info('before');
    ok(buf.join('').length > 0);
    buf.length = 0;

    useLayers().add({ path: '/test-printer-silent', input: { printer: { silent: true } } });
    usePrinter().info('after');
    usePrinter().error('also');
    strictEqual(buf.join(''), '');
  });

  it('reflects layer mutations on subsequent calls', () => {
    useLayers().add({ path: '/test-printer-on', input: { printer: { debug: true } } });
    usePrinter().debug('one');
    ok(buf.join('').includes('one'));
    buf.length = 0;

    useLayers().remove('/test-printer-on');
    usePrinter().debug('two');
    strictEqual(buf.join(''), '');
  });

  it('drops every call after `useEnv().set("SILENT", true)`', () => {
    usePrinter().info('before');
    ok(buf.join('').length > 0);
    buf.length = 0;

    useEnv().set('SILENT', true);
    usePrinter().info('after');
    strictEqual(buf.join(''), '');
  });

  it('emits debug after `useEnv().set("DEBUG", true)`', () => {
    usePrinter().debug('before');
    strictEqual(buf.join(''), '');

    useEnv().set('DEBUG', true);
    usePrinter().debug('after');
    ok(buf.join('').includes('after'));
  });

  it('overrides a layer `printer.silent: true` when `SILENT` is set to `false`', () => {
    useLayers().add({ path: '/test-printer-silent-env', input: { printer: { silent: true } } });
    usePrinter().info('hidden');
    strictEqual(buf.join(''), '');
    buf.length = 0;

    useEnv().set('SILENT', false);
    usePrinter().info('visible');
    ok(buf.join('').includes('visible'));
  });

  it('overrides a layer `printer.debug: true` when `DEBUG` is set to `false`', () => {
    useLayers().add({ path: '/test-printer-debug-env', input: { printer: { debug: true } } });
    usePrinter().debug('visible');
    ok(buf.join('').includes('visible'));
    buf.length = 0;

    useEnv().set('DEBUG', false);
    usePrinter().debug('hidden');
    strictEqual(buf.join(''), '');
  });

  it('respects `useEnv().set("NO_COLOR", true)` over a manual `color: true`', () => {
    const ESC = '\x1b';
    usePrinter().configure({
      stream: { write: (s: string) => buf.push(s), isTTY: true },
      color: true,
    });

    useEnv().set('NO_COLOR', true);

    buf.length = 0;
    usePrinter().info('hi');
    ok(!buf.join('').includes(`${ESC}[`));
  });

  it('drops every call after `.env` fills `SILENT`, and prints again once it is retracted', () => {
    useEnv().fill({ SILENT: '1' });
    usePrinter().info('hidden');
    strictEqual(buf.join(''), '');

    useEnv().fill({});
    usePrinter().info('shown');
    ok(buf.join('').includes('shown'));
  });

  it('strips ANSI after `.env` fills `NO_COLOR` over a manual `color: true`', () => {
    const ESC = '\x1b';
    useEnv().unset('NO_COLOR');
    usePrinter().configure({
      stream: { write: (s: string) => buf.push(s), isTTY: true },
      color: true,
    });

    useEnv().fill({ NO_COLOR: '1' });

    buf.length = 0;
    usePrinter().info('hi');
    ok(!buf.join('').includes(`${ESC}[`));
  });

  it('unsetting `FORCE_COLOR` reverts to TTY auto-detection', () => {
    const ESC = '\x1b';
    usePrinter().configure({
      stream: { write: (s: string) => buf.push(s), isTTY: true },
      color: undefined,
    });

    buf.length = 0;
    usePrinter().info('baseline');
    ok(
      buf.join('').includes(`${ESC}[`),
      'baseline: FORCE_COLOR unset on a TTY stream should auto-detect ANSI on',
    );

    useEnv().set('FORCE_COLOR', false);
    buf.length = 0;
    usePrinter().info('forced off');
    ok(!buf.join('').includes(`${ESC}[`), 'FORCE_COLOR=false should force ANSI off');

    useEnv().unset('FORCE_COLOR');
    buf.length = 0;
    usePrinter().info('reverted');
    ok(
      buf.join('').includes(`${ESC}[`),
      '`FORCE_COLOR` unset should defer to TTY auto-detection (per `Env.FORCE_COLOR` JSDoc)',
    );
  });

  it('returns a stable instance across calls', () => {
    strictEqual(usePrinter(), usePrinter());
  });
});
