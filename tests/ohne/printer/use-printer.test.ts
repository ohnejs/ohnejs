import { ok, strictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { useEnv, useLayers, usePrinter } from 'ohne';

function capture(): string[] {
  const buf: string[] = [];
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

  it('preserves a manual `configure({ color })` across unrelated env changes', () => {
    const ESC = '\x1b';
    usePrinter().configure({ color: true });

    useEnv().set('SILENT', false);
    useEnv().set('DEBUG', false);
    useEnv().unset('SILENT');
    useEnv().unset('DEBUG');

    buf.length = 0;
    usePrinter().info('hi');
    ok(
      buf.join('').includes(`${ESC}[`),
      'expected ANSI escape but got: ' + JSON.stringify(buf.join('')),
    );
  });

  it('respects `useEnv().set("NO_COLOR", true)` over a manual `color: true`', () => {
    const ESC = '\x1b';
    usePrinter().configure({ color: true });

    useEnv().set('NO_COLOR', true);

    buf.length = 0;
    usePrinter().info('hi');
    ok(!buf.join('').includes(`${ESC}[`));
  });

  it('returns a stable instance across calls', () => {
    strictEqual(usePrinter(), usePrinter());
  });
});
