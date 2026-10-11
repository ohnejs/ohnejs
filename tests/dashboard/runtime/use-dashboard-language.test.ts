import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import {
  commitDashboardLanguage,
  requestedLanguage,
  useDashboardLanguage,
} from '../../../src/dashboard/runtime/use-dashboard-language.ts';

describe('useDashboardLanguage', () => {
  before(() => {
    Object.assign(globalThis, {
      document: {
        getElementById: () => ({
          textContent: JSON.stringify({
            apiURL: 'http://api',
            defaultLanguage: 'en',
            messageGroups: [],
          }),
        }),
      },
    });
  });

  it('starts at the default language', () => {
    strictEqual(useDashboardLanguage().value, 'en');
  });

  it('follows the request before any commit', () => {
    requestedLanguage().value = 'de';
    strictEqual(useDashboardLanguage().value, 'de');
  });

  it('holds a committed language until the next commit', () => {
    commitDashboardLanguage();
    requestedLanguage().value = 'bs';
    strictEqual(useDashboardLanguage().value, 'de');
    commitDashboardLanguage();
    strictEqual(useDashboardLanguage().value, 'bs');
  });
});
