import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../../src/ohne/fields/define-field.ts';

import { select } from '../../../../src/ohne/fields/builtin/select.ts';
import { searchHook } from '../../../../src/ohne/fields/field-search.ts';

type ValidateCtx = Parameters<NonNullable<typeof select.validators>[number]>[1];
type EmitCtx = Parameters<NonNullable<typeof select.emitType>>[0];

const ctx = (options: Record<string, unknown>) =>
  ({ options, errors: {} }) as unknown as ValidateCtx;

const emitCtx = (options: Record<string, unknown>) => ({ options }) as unknown as EmitCtx;

const membership = select.validators![0];

describe('select membership', () => {
  it('accepts a declared string choice', () => {
    strictEqual(membership('draft', ctx({ choices: ['draft', 'live'] })), undefined);
  });

  it('accepts the value of a labeled choice', () => {
    const choices = ['draft', { value: 'live', label: 'Published' }];
    strictEqual(membership('live', ctx({ choices })), undefined);
  });

  it('rejects a value outside the choices', () => {
    strictEqual(
      membership('gone', ctx({ choices: ['draft', 'live'] })),
      'validation.invalidChoice',
    );
  });

  it('rejects a label offered as the value', () => {
    const choices = ['draft', { value: 'live', label: 'Published' }];
    strictEqual(membership('Published', ctx({ choices })), 'validation.invalidChoice');
  });
});

describe('select emitType', () => {
  it('emits the union of the choice values', () => {
    strictEqual(select.emitType!(emitCtx({ choices: ['draft', 'live'] })), "'draft' | 'live'");
    strictEqual(
      select.emitType!(emitCtx({ choices: [{ value: 'a', label: 'A' }, 'b'] })),
      "'a' | 'b'",
    );
  });

  it('escapes a single quote inside a choice value', () => {
    strictEqual(select.emitType!(emitCtx({ choices: ["it's"] })), "'it\\'s'");
  });
});

const selectSearch = searchHook(select)!;

const search = (token: string, options: Record<string, unknown> = {}) =>
  selectSearch({
    name: 'field',
    options,
    token,
    resolveMessage: (message) => (message === 'app.status.live' ? 'Published' : String(message)),
  } as FieldSearchContext);

describe('select search', () => {
  const choices = ['draft', { value: 'live', label: 'app.status.live' }, 'on-hold'];

  it('matches a choice value by a word prefix, ignoring case', () => {
    deepStrictEqual(search('DRA', { choices }), { in: ['draft'] });
    deepStrictEqual(search('hold', { choices }), { in: ['on-hold'] });
  });

  it('matches a labeled choice through its resolved label', () => {
    deepStrictEqual(search('publ', { choices }), { in: ['live'] });
    deepStrictEqual(search('liv', { choices }), { in: ['live'] });
  });

  it('gives every matching choice', () => {
    deepStrictEqual(search('o', { choices: ['open', 'overdue', 'closed'] }), {
      in: ['open', 'overdue'],
    });
  });

  it('gives `null` when no choice matches', () => {
    strictEqual(search('aft', { choices }), null);
  });
});
