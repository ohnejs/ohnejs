import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import { computed } from '../../../src/utils/reactive/computed.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { inputOf, type } from './_controls.ts';

const { createFieldForm } = await import('../../../src/dashboard/fields/field-form.ts');
const { h } = await import('../../../src/dashboard/render/h.ts');
await import('../../../src/dashboard/fields/builtin/text.ts');
await import('../../../src/dashboard/fields/builtin/repeater.ts');
await import('../../../src/dashboard/fields/builtin/object.ts');

/**
 * A plain `text` column described as the server describes it.
 */
function textField(name: string, overrides: Partial<DashboardField> = {}): DashboardField {
  return {
    name,
    type: 'text',
    kind: 'column',
    logicalType: 'text',
    label: name,
    nullable: false,
    required: true,
    unique: false,
    translatable: false,
    readable: true,
    writable: true,
    immutable: false,
    ...overrides,
  };
}

/**
 * A composite field the server describes, holding one required `text` subfield.
 */
function compositeField(
  name: string,
  type: 'repeater' | 'object',
  subfield: string,
): DashboardField {
  return {
    ...textField(name, { required: false }),
    type,
    kind: type === 'repeater' ? 'childMany' : 'childOne',
    logicalType: undefined,
    subfields: [textField(subfield)],
  };
}

const roster = compositeField('roster', 'repeater', 'name');
const meta = compositeField('meta', 'object', 'title');

const language = (): string => 'en';

describe('createFieldForm', () => {
  it('reads an empty required field on create as `validation.required` without showing it', () => {
    effectScope().run(() => {
      const form = createFieldForm([textField('raid')], undefined, {
        mode: 'create',
        path: '',
        language,
      });
      deepStrictEqual(structuredClone(form.read()), { errors: { raid: 'validation.required' } });
      strictEqual(form.controlOf('raid')?.error(), '');
      strictEqual(form.errored(), false);
      strictEqual(form.focusError(), false);
    });
  });

  it('shows a failed read through `setErrors`', () => {
    effectScope().run(() => {
      const form = createFieldForm([textField('raid')], undefined, {
        mode: 'create',
        path: '',
        language,
      });
      strictEqual(form.setErrors(form.read().errors ?? {}), '');
      strictEqual(form.controlOf('raid')?.error(), 'validation.required');
      strictEqual(form.errored(), true);
      strictEqual(form.focusError(), true);
    });
  });

  it('reads a changed value that fails its check quietly, and shows it through `setErrors`', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('raid', { options: { max: 4 } })],
        { raid: 'Ony' },
        { mode: 'edit', path: '', language },
      );
      const element = h('div', null, form.render());
      type(inputOf(element), 'Naxxramas');
      const reading = form.read();
      deepStrictEqual(structuredClone(reading), { errors: { raid: 'validation.maxLength' } });
      deepStrictEqual(structuredClone(form.readPatch()), structuredClone(reading));
      strictEqual(form.controlOf('raid')?.error(), '');
      strictEqual(form.setErrors(reading.errors ?? {}), '');
      strictEqual(form.controlOf('raid')?.error(), 'validation.maxLength');
    });
  });

  it('reads an empty required field in a nested item quietly, and routes it back through `setErrors`', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [roster, meta],
        { roster: [{}], meta: {} },
        { mode: 'edit', path: '', language },
      );
      const reading = form.read();
      deepStrictEqual(structuredClone(reading), {
        errors: { 'roster[0].name': 'validation.required', 'meta.title': 'validation.required' },
      });
      strictEqual(form.errored(), false);
      strictEqual(form.setErrors(reading.errors ?? {}), '');
      strictEqual(form.controlOf('roster')?.errored?.(), true);
      strictEqual(form.controlOf('meta')?.errored?.(), true);
      strictEqual(form.setErrors({}), '');
      strictEqual(form.errored(), false);
    });
  });

  it('snapshots a nested item quietly inside a `computed`, as an undo history does on every change', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [roster],
        { roster: [{}] },
        { mode: 'edit', path: '', language },
      );
      deepStrictEqual(computed(() => form.snapshot()).value, {});
      strictEqual(form.errored(), false);
    });
  });

  it('skips the required check at the top of an edit, where an update keeps omitted fields', () => {
    effectScope().run(() => {
      const form = createFieldForm([textField('raid')], undefined, {
        mode: 'edit',
        path: '',
        language,
      });
      deepStrictEqual(structuredClone(form.read()), { value: {} });
    });
  });

  it('checks required fields of a nested item even in edit mode', () => {
    effectScope().run(() => {
      const form = createFieldForm([textField('name')], undefined, {
        mode: 'edit',
        path: 'roster[0]',
        language,
      });
      deepStrictEqual(structuredClone(form.read()), { errors: { name: 'validation.required' } });
    });
  });

  it('leaves a gated or optional field out of the required check', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('motto', { required: false }), textField('raid', { when: { heroic: true } })],
        undefined,
        { mode: 'create', path: '', language },
      );
      deepStrictEqual(structuredClone(form.read()), { value: {} });
    });
  });

  it('wraps a gated row in `ohne-field-gate`, so the field rhythm spaces it like a plain row', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('raid'), textField('motto', { when: { raid: 'Naxxramas' } })],
        undefined,
        { mode: 'create', path: '', language },
      );
      const rendered = form.render() as unknown as { getAttribute(name: string): string | null }[];
      strictEqual(rendered[1]?.getAttribute('class'), 'ohne-field-gate');
    });
  });

  it('seeds a control from `options.default` when the item holds no value', () => {
    effectScope().run(() => {
      const field = textField('faction', { options: { default: 'horde' } });
      const form = createFieldForm([field], undefined, { mode: 'create', path: '', language });
      deepStrictEqual(structuredClone(form.read()), { value: { faction: 'horde' } });
      strictEqual(form.dirty(), false);
      form.rebase({});
      deepStrictEqual(structuredClone(form.read()), { value: { faction: 'horde' } });
    });
  });

  it('runs the control checks on a changed value only', () => {
    effectScope().run(() => {
      const field = textField('raid', { options: { max: 4 } });
      const form = createFieldForm(
        [field],
        { raid: 'Molten Core' },
        {
          mode: 'edit',
          path: '',
          language,
        },
      );
      const element = h('div', null, form.render());
      deepStrictEqual(structuredClone(form.read()), { value: { raid: 'Molten Core' } });
      type(inputOf(element), 'Naxxramas');
      deepStrictEqual(structuredClone(form.read()), { errors: { raid: 'validation.maxLength' } });
      type(inputOf(element), 'Ony');
      deepStrictEqual(structuredClone(form.read()), { value: { raid: 'Ony' } });
    });
  });

  it('snapshots quietly, showing no message for a field that fails', () => {
    effectScope().run(() => {
      const form = createFieldForm([textField('raid')], undefined, {
        mode: 'create',
        path: '',
        language,
      });
      deepStrictEqual(form.snapshot(), {});
      strictEqual(form.controlOf('raid')?.error(), '');
    });
  });
});
