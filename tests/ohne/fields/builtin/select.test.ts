import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { select } from '../../../../src/ohne/fields/builtin/select.ts';

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
