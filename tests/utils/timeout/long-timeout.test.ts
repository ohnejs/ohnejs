import { strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { longTimeout } from '../../../src/utils/index.ts';

const MAX_DELAY = 2_147_483_647;

describe('longTimeout', () => {
  it('fires a short delay like a plain setTimeout', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = false;
      longTimeout(() => (fired = true), 100);
      mock.timers.tick(99);
      strictEqual(fired, false);
      mock.timers.tick(1);
      strictEqual(fired, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('chains past the 32-bit wall instead of clamping to 1ms', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = false;
      longTimeout(() => (fired = true), MAX_DELAY + 500);
      mock.timers.tick(MAX_DELAY);
      strictEqual(fired, false);
      mock.timers.tick(499);
      strictEqual(fired, false);
      mock.timers.tick(1);
      strictEqual(fired, true);
    } finally {
      mock.timers.reset();
    }
  });

  it('cancels across a chunk boundary', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = false;
      const cancel = longTimeout(() => (fired = true), MAX_DELAY + 500);
      mock.timers.tick(MAX_DELAY);
      cancel();
      mock.timers.tick(1000);
      strictEqual(fired, false);
    } finally {
      mock.timers.reset();
    }
  });
});
