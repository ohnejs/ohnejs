import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { debounce } from '../../../src/utils/index.ts';

describe('debounce', () => {
  it('runs once on the trailing edge after the last call', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let calls = 0;
      const fn = debounce(() => {
        calls++;
      }, 100);

      fn();
      fn();
      fn();
      mock.timers.tick(99);
      strictEqual(calls, 0);

      mock.timers.tick(1);
      strictEqual(calls, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('restarts the timer on each call', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let calls = 0;
      const fn = debounce(() => {
        calls++;
      }, 100);

      fn();
      mock.timers.tick(60);
      fn();
      mock.timers.tick(60);
      strictEqual(calls, 0);

      mock.timers.tick(40);
      strictEqual(calls, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('forwards only the most recent arguments', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const seen: string[] = [];
      const fn = debounce((value: string) => {
        seen.push(value);
      }, 50);

      fn('a');
      fn('b');
      fn('c');
      mock.timers.tick(50);
      deepStrictEqual(seen, ['c']);
    } finally {
      mock.timers.reset();
    }
  });

  it('cancel clears a pending call', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let calls = 0;
      const fn = debounce(() => {
        calls++;
      }, 50);

      fn();
      fn.cancel();
      mock.timers.tick(100);
      strictEqual(calls, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('runs again after a completed cycle', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let calls = 0;
      const fn = debounce(() => {
        calls++;
      }, 50);

      fn();
      mock.timers.tick(50);
      strictEqual(calls, 1);

      fn();
      mock.timers.tick(50);
      strictEqual(calls, 2);
    } finally {
      mock.timers.reset();
    }
  });
});
