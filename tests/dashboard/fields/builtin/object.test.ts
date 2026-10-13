import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import '../_controls.ts';

const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');
await import('../../../../src/dashboard/fields/builtin/object.ts');

const text = (name: string, options: Record<string, unknown> = {}) => ({
  name,
  type: 'text',
  kind: 'column',
  label: name,
  nullable: false,
  required: true,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  ...options,
});

const object = (nullable: boolean) => ({
  ...text('meta'),
  type: 'object',
  kind: 'childOne',
  nullable,
  required: !nullable,
  subfields: [text('tag', { nullable: true, required: false })],
});

const create = (field: unknown) =>
  createFieldForm([field] as never, undefined, { mode: 'create', path: '', language: () => 'en' });

describe('object control on create', () => {
  it('reads a pristine required object as its subform value', () => {
    effectScope().run(() => {
      deepStrictEqual(structuredClone(create(object(false)).read()), { value: { meta: {} } });
    });
  });

  it('omits a pristine nullable object', () => {
    effectScope().run(() => {
      deepStrictEqual(structuredClone(create(object(true)).read()), { value: {} });
    });
  });
});
