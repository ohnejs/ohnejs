import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Transaction } from '../../../src/ohne/database/adapter.ts';
import type { FieldInstance } from '../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../src/ohne/fields/known-fields.ts';
import type { Message, ParamlessMessageKey } from '../../../src/ohne/messages/known-messages.ts';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { defineField } from '../../../src/ohne/fields/define-field.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { resolveMessage } from '../../../src/ohne/http/translate.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { queryMetadata } from '../../../src/ohne/query/metadata.ts';
import { runRecord } from '../../../src/ohne/query/pipeline/run-record.ts';

declare module 'ohne' {
  interface KnownMessages {
    'validatorTest.plain': {};
    'validatorTest.ranged': { max: number };
  }
}

describe('validator message typing', () => {
  it('resolves ParamlessMessageKey to param-free keys only, so the editor offers them', () => {
    // Compiles only if it is the literal union (not `never`); the @ts-expect-error proves it is not `string`.
    const paramFree: ParamlessMessageKey = 'validatorTest.plain';
    // @ts-expect-error a param-ful key is not a bare param-free key
    const paramFul: ParamlessMessageKey = 'validatorTest.ranged';
    ok(typeof paramFree === 'string' && typeof paramFul === 'string');
  });

  it('accepts a param-free key, any plain string, or a { key, params } object', () => {
    const paramlessKey: Message = 'validatorTest.plain';
    const plain: Message = 'this field is invalid';
    const withParams: Message = { key: 'validatorTest.ranged', params: { max: 10 } };
    const paramlessObject: Message = { key: 'validatorTest.plain' };
    ok([paramlessKey, plain, withParams, paramlessObject].length === 4);
  });

  it('rejects wrong params, missing params, and params on a param-free key', () => {
    // @ts-expect-error `validatorTest.ranged` expects { max: number }, not { min: number }
    const wrongParams: Message = { key: 'validatorTest.ranged', params: { min: 10 } };
    // @ts-expect-error `validatorTest.ranged` requires its `params`
    const missingParams: Message = { key: 'validatorTest.ranged' };
    // @ts-expect-error a param-free key takes no `params`
    const paramlessParams: Message = { key: 'validatorTest.plain', params: {} };
    ok([wrongParams, missingParams, paramlessParams].every((m) => typeof m === 'object'));
  });

  it('accepts every form on a field() validator', () => {
    field('text', {
      validators: [
        (value) => (value === '' ? 'validatorTest.plain' : undefined),
        (value) =>
          value.length > 10 ? { key: 'validatorTest.ranged', params: { max: 10 } } : undefined,
      ],
    });
  });

  it('enforces the strict object contract on a field() validator too', () => {
    field('text', {
      validators: [
        // @ts-expect-error `validatorTest.ranged` expects { max: number }, not { min: number }
        (value) => (value ? { key: 'validatorTest.ranged', params: { min: 1 } } : undefined),
      ],
    });
  });
});

const ranged = defineField({
  columnType: 'text',
  validators: [
    (value) => (value === 'bad' ? { key: 'validatorTest.ranged', params: { max: 5 } } : undefined),
  ],
});
useFields().register('rangedText', { name: 'rangedText' as FieldTypeName, fieldType: ranged });
useCollections().register('VMPost', {
  name: 'VMPost',
  collection: {
    fields: { title: { type: 'rangedText', options: {} } as unknown as FieldInstance },
  },
});
useMessages().register('en', {
  ...useMessages().get('en'),
  'validatorTest.ranged': 'Max is {max}',
});

describe('validator message at runtime', () => {
  it('carries a { key, params } object unresolved, then resolves it at the boundary', async () => {
    const result = await runRecord(
      queryMetadata('VMPost'),
      { title: 'bad' },
      {
        operation: 'create',
        tx: {} as Transaction,
      },
    );
    ok(!result.ok);
    deepStrictEqual(result.errors.title, { key: 'validatorTest.ranged', params: { max: 5 } });
    strictEqual(resolveMessage(result.errors.title), 'Max is 5');
  });
});
