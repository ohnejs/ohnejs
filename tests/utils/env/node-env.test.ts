import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { isDevelopment, isProduction, isTest, nodeEnv } from '../../../src/utils/env/index.ts';

describe('nodeEnv', () => {
  it('matches `production` and `test` exactly', () => {
    strictEqual(nodeEnv('production'), 'production');
    strictEqual(nodeEnv('test'), 'test');
    strictEqual(nodeEnv('development'), 'development');
  });

  it('falls back to `development` for unknown or unset values', () => {
    strictEqual(nodeEnv('staging'), 'development');
    strictEqual(nodeEnv(''), 'development');
    strictEqual(nodeEnv(undefined), 'development');
  });

  it('is case-sensitive', () => {
    strictEqual(nodeEnv('Production'), 'development');
    strictEqual(nodeEnv('TEST'), 'development');
  });
});

describe('isProduction', () => {
  it('is true only for `production`', () => {
    strictEqual(isProduction('production'), true);
    strictEqual(isProduction('development'), false);
    strictEqual(isProduction('test'), false);
    strictEqual(isProduction(undefined), false);
  });
});

describe('isDevelopment', () => {
  it('is true for `development` and any unrecognized value', () => {
    strictEqual(isDevelopment('development'), true);
    strictEqual(isDevelopment('staging'), true);
    strictEqual(isDevelopment(undefined), true);
    strictEqual(isDevelopment('production'), false);
    strictEqual(isDevelopment('test'), false);
  });
});

describe('isTest', () => {
  it('is true only for `test`', () => {
    strictEqual(isTest('test'), true);
    strictEqual(isTest('development'), false);
    strictEqual(isTest('production'), false);
    strictEqual(isTest(undefined), false);
  });
});

describe('process.env.NODE_ENV default', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('reads the live environment when no value is passed', () => {
    process.env.NODE_ENV = 'production';
    strictEqual(nodeEnv(), 'production');
    strictEqual(isProduction(), true);
    strictEqual(isDevelopment(), false);
  });

  it('resolves to `development` when unset', () => {
    delete process.env.NODE_ENV;
    strictEqual(nodeEnv(), 'development');
    strictEqual(isDevelopment(), true);
  });
});
