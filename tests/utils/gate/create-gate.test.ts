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

  it('close is idempotent, later calls share the first promise', async () => {
    const gate = createGate();
    const release = gate.enter()!;

    const first = gate.close();
    const second = gate.close();
    strictEqual(first, second);

    release();
    deepStrictEqual(await first, { drained: true, pending: 0 });
  });
});
