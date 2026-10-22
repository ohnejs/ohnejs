import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldForm } from '../../../src/dashboard/fields/field-form.ts';
import type { DashboardBlock, DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import './_controls.ts';

const { blockTitle } = await import('../../../src/dashboard/fields/_blocks.ts');
await import('../../../src/dashboard/fields/builtin/text.ts');
await import('../../../src/dashboard/fields/builtin/rich-text.ts');

const column = (name: string, type: string): DashboardField => ({
  name,
  type,
  kind: 'column',
  logicalType: type === 'text' ? 'text' : undefined,
  label: name,
  nullable: true,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
});

/**
 * A form whose controls read `values`.
 */
const formOf = (values: Record<string, unknown>): FieldForm =>
  ({
    controlOf: (name: string) => ({ read: () => ({ value: values[name] }) }),
  }) as unknown as FieldForm;

const INTRO: DashboardBlock = {
  name: 'Intro',
  label: 'Heading',
  fields: [column('heading', 'richText')],
  titleField: 'heading',
};

const NOTE: DashboardBlock = { name: 'Note', label: 'Note', fields: [column('text', 'text')] };

describe('blockTitle', () => {
  it('names an instance by its rich text title as plain text', () => {
    const heading = [
      { kind: 'paragraph', content: [{ text: 'Hello ' }, { text: 'world', marks: ['strong'] }] },
    ];
    strictEqual(blockTitle(INTRO, 'Intro', formOf({ heading })), 'Heading (Hello world)');
  });

  it('keeps the bare label for an empty title or a block without one', () => {
    strictEqual(blockTitle(INTRO, 'Intro', formOf({ heading: [] })), 'Heading');
    strictEqual(blockTitle(NOTE, 'Note', formOf({ text: 'A plain note' })), 'Note');
  });

  it('names an undescribed block by its name', () => {
    strictEqual(blockTitle(undefined, 'Gone', formOf({})), 'Gone');
  });
});
