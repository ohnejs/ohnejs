import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';
import type { FakeElement } from '../_fake-dom.ts';

import { isUndefined } from '../../../src/utils/is/is-undefined.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { computed } from '../../../src/utils/reactive/computed.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { inputOf, type } from './_controls.ts';

const { createFieldForm } = await import('../../../src/dashboard/fields/field-form.ts');
const { registerUntypedFieldType } = await import('../../../src/dashboard/fields/field-type.ts');
const { h } = await import('../../../src/dashboard/render/h.ts');
await import('../../../src/dashboard/fields/builtin/text.ts');
await import('../../../src/dashboard/fields/builtin/repeater.ts');
await import('../../../src/dashboard/fields/builtin/object.ts');
await import('../../../src/dashboard/fields/builtin/integer.ts');

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

// A control without a `draft` whose read always fails, as an app's own type may be.
registerUntypedFieldType('flaky', {
  display: () => null,
  control: () => ({
    element: null,
    read: () => ({ errors: { '': 'nope' } }),
    setErrors: () => '',
    error: () => '',
    dirty: () => true,
    focus() {},
    revert() {},
    rebase() {},
  }),
});

// A control that logs what the form asks of it, with or without a `restore` of its own.
const asked: string[] = [];
let ping: ((discrete?: boolean) => void) | undefined;
for (const [type, restorable] of [
  ['logged', true],
  ['legacy', false],
] as const) {
  registerUntypedFieldType(type, {
    display: () => null,
    control: ({ field, initial, onInput }) => {
      let held = initial;
      ping = onInput;
      const log = (what: string, value: unknown): void => {
        asked.push(`${field.name}:${what}:${String(value)}`);
      };
      return {
        element: null,
        read: () => (isUndefined(held) ? {} : { value: held }),
        setErrors: () => '',
        error: () => '',
        dirty: () => false,
        focus() {},
        revert() {
          log('revert', held);
        },
        rebase(value) {
          held = value;
          log('rebase', value);
        },
        restore: restorable
          ? (value): void => {
              held = value;
              log('restore', value);
            }
          : undefined,
      };
    },
  });
}

const logged = (name: string, type: 'logged' | 'legacy'): DashboardField =>
  textField(name, { type, logicalType: undefined, required: false });

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
        { roster: [{ UUID: 'r1' }] },
        { mode: 'edit', path: '', language },
      );
      deepStrictEqual(computed(() => form.snapshot()).value, {});
      deepStrictEqual(computed(() => form.draft()).value, { roster: [{ UUID: 'r1' }] });
      strictEqual(form.errored(), false);
    });
  });

  it('drafts a value that fails its check as the user has it, where a snapshot keeps the fallback', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('raid', { options: { max: 4 } })],
        { raid: 'Ony' },
        { mode: 'edit', path: '', language },
      );
      const element = h('div', null, form.render());
      type(inputOf(element), 'Naxxramas');
      deepStrictEqual(form.draft({ raid: 'Ony' }), { raid: 'Naxxramas' });
      deepStrictEqual(form.snapshot({ raid: 'Ony' }), { raid: 'Ony' });
      deepStrictEqual(structuredClone(form.read()), { errors: { raid: 'validation.maxLength' } });
      strictEqual(form.controlOf('raid')?.error(), '');
    });
  });

  it('drafts a nested item with an empty required field, down to its typed subfields', () => {
    effectScope().run(() => {
      const crew = {
        ...roster,
        subfields: [textField('motto', { required: false }), textField('name')],
      };
      const form = createFieldForm(
        [crew, meta],
        { roster: [{ UUID: 'r1' }], meta: {} },
        { mode: 'edit', path: '', language },
      );
      const element = h('div', null, form.render());
      type(inputOf(element), 'For the Horde');
      deepStrictEqual(form.draft({ roster: [], meta: { title: 'old' } }), {
        roster: [{ motto: 'For the Horde', UUID: 'r1' }],
        meta: {},
      });
      deepStrictEqual(structuredClone(form.read()), {
        errors: { 'roster[0].name': 'validation.required', 'meta.title': 'validation.required' },
      });
    });
  });

  it('keeps the fallback for a control without a draft whose read fails', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('omen', { type: 'flaky', logicalType: undefined })],
        { omen: 'old' },
        { mode: 'edit', path: '', language },
      );
      deepStrictEqual(form.draft({ omen: 'last' }), { omen: 'last' });
      deepStrictEqual(form.draft(), {});
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

  it('asks a value of a field emptied at the top of an edit, defaulted or not', () => {
    effectScope().run(() => {
      for (const overrides of [{}, { required: false, options: { default: 3 } }]) {
        const count = textField('count', { type: 'integer', logicalType: 'integer', ...overrides });
        const form = createFieldForm([count], { count: 5 }, { mode: 'edit', path: '', language });
        type(inputOf(form.controlOf('count')!.element), '');
        const failed = { errors: { count: 'validation.required' } };
        deepStrictEqual(structuredClone(form.read()), failed);
        deepStrictEqual(structuredClone(form.readPatch()), failed);
      }
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

  it('restores a state into the live controls, leaving one whose value already matches untouched', () => {
    effectScope().run(() => {
      asked.length = 0;
      const form = createFieldForm(
        [logged('kept', 'logged'), logged('moved', 'logged'), logged('old', 'legacy')],
        { kept: 'a', moved: 'b', old: 'c' },
        { mode: 'edit', path: '', language },
      );
      form.restore({ kept: 'a', moved: 'B', old: 'C' });
      deepStrictEqual(asked, ['moved:restore:B', 'old:rebase:C', 'old:revert:C']);
      deepStrictEqual(form.draft(), { kept: 'a', moved: 'B', old: 'C' });
    });
  });

  it('restores a value in place, so the control keeps its node and reads dirty against its baseline', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('raid', { options: { max: 4 } })],
        { raid: 'Ony' },
        { mode: 'edit', path: '', language },
      );
      const element = h('div', null, form.render());
      const input = inputOf(element) as FakeElement & { value: string };
      type(input, 'Naxx');
      form.restore({ raid: 'Naxxramas' });
      flush();
      strictEqual(inputOf(element), input);
      strictEqual(input.value, 'Naxxramas');
      strictEqual(form.dirty(), true);
      deepStrictEqual(structuredClone(form.read()), { errors: { raid: 'validation.maxLength' } });
      form.restore({ raid: 'Ony' });
      strictEqual(form.dirty(), false);
    });
  });

  it('restores a field the state holds no value for to its default', () => {
    effectScope().run(() => {
      const form = createFieldForm(
        [textField('faction', { options: { default: 'horde' } })],
        { faction: 'alliance' },
        { mode: 'edit', path: '', language },
      );
      form.restore({});
      deepStrictEqual(form.draft(), { faction: 'horde' });
      strictEqual(form.dirty(), true);
    });
  });

  it('relays a discrete change through `onInput`', () => {
    effectScope().run(() => {
      const seen: (boolean | undefined)[] = [];
      createFieldForm([logged('pick', 'logged')], undefined, {
        mode: 'create',
        path: '',
        language,
        onInput: (discrete) => seen.push(discrete),
      });
      ping?.(true);
      ping?.();
      deepStrictEqual(seen, [true, undefined]);
    });
  });
});
