import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { createGate } from '../../../src/utils/index.ts';

describe('createGate', () => {
  it('admits work while open and tracks pending', () => {
    const gate = createGate();
    strictEqual(gate.state, 'open');
    strictEqual(gate.pending, 0);

    const release = gate.enter();
    strictEqual(typeof release, 'function');
    strictEqual(gate.pending, 1);

    release!();
    strictEqual(gate.pending, 0);
  });

  it('release is idempotent', () => {
    const gate = createGate();
    const release = gate.enter()!;
    gate.enter();
    strictEqual(gate.pending, 2);

    release();
    release();
    strictEqual(gate.pending, 1);
  });

  it('refuses new work while closing or closed', async () => {
    const gate = createGate();
    const release = gate.enter()!;

    const closing = gate.close();
    strictEqual(gate.state, 'closing');
    strictEqual(gate.enter(), null);

    release();
    deepStrictEqual(await closing, { drained: true, pending: 0 });
    strictEqual(gate.state, 'closed');
    strictEqual(gate.enter(), null);
  });

  it('drains immediately when nothing is in flight', async () => {
    const gate = createGate();
    const drain = await gate.close();
    deepStrictEqual(drain, { drained: true, pending: 0 });
    strictEqual(gate.state, 'closed');
  });

  it('resolves when the last in-flight unit releases', async () => {
    const gate = createGate();
    const a = gate.enter()!;
    const b = gate.enter()!;

    let settled = false;
    const closing = gate.close().then((d) => {
      settled = true;
      return d;
    });

    a();
    await Promise.resolve();
    strictEqual(settled, false);
    strictEqual(gate.state, 'closing');

    b();
    deepStrictEqual(await closing, { drained: true, pending: 0 });
    strictEqual(settled, true);
    strictEqual(gate.state, 'closed');
  });

  it('reports undrained pending when the timeout wins', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const gate = createGate();
      gate.enter();
      gate.enter();

      const closing = gate.close({ timeout: '5s' });
      mock.timers.tick(5000);

      deepStrictEqual(await closing, { drained: false, pending: 2 });
      strictEqual(gate.state, 'closed');
    } finally {
      mock.timers.reset();
    }
  });

  it('waits a timeout past the 32-bit timer wall in full', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const gate = createGate();
      gate.enter();

      let settled = false;
      const closing = gate.close({ timeout: '30d' }).then((drain) => {
        settled = true;
        return drain;
      });

      mock.timers.tick(2_147_483_647);
      await Promise.resolve();
      strictEqual(settled, false);

      mock.timers.tick(444_516_353);
      deepStrictEqual(await closing, { drained: false, pending: 1 });
    } finally {
      mock.timers.reset();
    }
  });

  it('a release after the timeout still decrements without throwing', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const gate = createGate();
      const late = gate.enter()!;

      const closing = gate.close({ timeout: 1000 });
      mock.timers.tick(1000);
      deepStrictEqual(await closing, { drained: false, pending: 1 });

      late();
      strictEqual(gate.pending, 0);
      strictEqual(gate.state, 'closed');
    } finally {
      mock.timers.reset();
    }
  });

  it('settled resolves at once when nothing is in flight', async () => {
    const gate = createGate();
    await gate.settled();
    strictEqual(gate.state, 'open');
  });

  it('settled waits past a timed-out close until the late release', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const gate = createGate();
      const late = gate.enter()!;

      const closing = gate.close({ timeout: 1000 });
      let settled = false;
      const idle = gate.settled().then(() => (settled = true));
      mock.timers.tick(1000);
      deepStrictEqual(await closing, { drained: false, pending: 1 });
      strictEqual(settled, false);

      late();
      await idle;
      strictEqual(settled, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('settled resolves with a clean drain', async () => {
    const gate = createGate();
    const release = gate.enter()!;

    const closing = gate.close();
    const idle = gate.settled();
    release();

    deepStrictEqual(await closing, { drained: true, pending: 0 });
    await idle;
    strictEqual(gate.pending, 0);
  });

  it('close is idempotent, later calls share the first promise', async () => {
    const gate = createGate();
    const release = gate.enter()!;

    const first = gate.close();
    const second = gate.close();
    strictEqual(first, second);

    release();
    deepStrictEqual(await first, { drained: true, pending: 0 });
  });

  it('cancel asks every unit in flight to stop, with the reason', () => {
    const gate = createGate();
    const heard: [string, unknown][] = [];
    gate.enter((reason) => heard.push(['Thrall', reason]));
    gate.enter((reason) => heard.push(['Jaina', reason]));
    gate.enter();
    const reason = new Error('shutting down');
    gate.cancel(reason);
    deepStrictEqual(heard, [
      ['Thrall', reason],
      ['Jaina', reason],
    ]);
    strictEqual(gate.pending, 3);
  });

  it('cancel skips a unit that already released', () => {
    const gate = createGate();
    let cancelled = 0;
    const release = gate.enter(() => cancelled++)!;
    release();
    gate.cancel();
    strictEqual(cancelled, 0);
  });

  it('keeps two units apart when they pass the same onCancel', () => {
    const gate = createGate();
    let cancelled = 0;
    const onCancel = (): void => void cancelled++;
    const release = gate.enter(onCancel)!;
    gate.enter(onCancel);
    release();
    release();
    strictEqual(gate.pending, 1);
    gate.cancel();
    strictEqual(cancelled, 1);
  });
});
