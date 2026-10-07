import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Message } from '../../../src/ohne/messages/known-messages.ts';

import { reportIssues } from '../../../src/ohne/fields/report-issues.ts';

describe('reportIssues', () => {
  it("returns the issue at `''` as the field's own message", () => {
    const errors: Record<string, Message> = {};
    strictEqual(
      reportIssues([{ path: '', key: 'validation.invalidValue' }], errors),
      'validation.invalidValue',
    );
    deepStrictEqual(errors, {});
  });

  it('writes a sub-path issue into `errors` at its path', () => {
    const errors: Record<string, Message> = {};
    strictEqual(
      reportIssues(
        [
          { path: '[0].level', key: 'validation.invalidChoice' },
          { path: '[1].content[0].link.url', key: 'validation.invalidLink' },
        ],
        errors,
      ),
      undefined,
    );
    deepStrictEqual(errors, {
      '[0].level': 'validation.invalidChoice',
      '[1].content[0].link.url': 'validation.invalidLink',
    });
  });

  it('carries params as a `{ key, params }` message', () => {
    const errors: Record<string, Message> = {};
    reportIssues(
      [{ path: '[0].items[0].list', key: 'validation.maxDepth', params: { max: 4 } }],
      errors,
    );
    deepStrictEqual(errors, {
      '[0].items[0].list': { key: 'validation.maxDepth', params: { max: 4 } },
    });
  });

  it('returns `undefined` and leaves `errors` alone without issues', () => {
    const errors: Record<string, Message> = {};
    strictEqual(reportIssues([], errors), undefined);
    deepStrictEqual(errors, {});
  });

  it('lands an issue at a `__proto__` path as an own key', () => {
    const errors: Record<string, Message> = {};
    reportIssues([{ path: '__proto__', key: 'validation.unknownField' }], errors);
    deepStrictEqual(Object.entries(errors), [['__proto__', 'validation.unknownField']]);
  });
});
