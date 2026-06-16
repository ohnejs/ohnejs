import { ok } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { useEnv, usePrinter } from 'ohne';

describe('usePrinter / FORCE_COLOR contract', () => {
  afterEach(() => {
    useEnv().unset('FORCE_COLOR');
    useEnv().unset('NO_COLOR');
  });

  it('unsetting `FORCE_COLOR` reverts to TTY auto-detection', () => {
    const ESC = '\x1b';
    const buf: string[] = [];

    usePrinter().configure({
      stream: { write: (s: string) => buf.push(s), isTTY: true },
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
});
