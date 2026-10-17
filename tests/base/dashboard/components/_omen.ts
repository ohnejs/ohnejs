import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

/**
 * A field of the `omen` type, which `registerOmen` registers.
 */
export const OMEN: DashboardField = {
  name: 'omen',
  type: 'omen',
  kind: 'column',
  label: 'Omen',
  nullable: true,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options: {},
};

/**
 * Registers `omen`, a type without a `draft` whose read fails once typed into, as an app's own type may.
 * An undo history never sees its edit, so only the form's dirt can guard it.
 */
export async function registerOmen(): Promise<void> {
  const { registerUntypedFieldType } =
    await import('../../../../src/dashboard/fields/field-type.ts');
  const { h } = await import('../../../../src/dashboard/render/h.ts');
  registerUntypedFieldType('omen', {
    display: () => null,
    control: ({ onInput }) => {
      let typed = false;
      const input = h('input');
      input.id = 'field-omen-input';
      input.addEventListener('input', () => {
        typed = true;
        onInput();
      });
      return {
        element: h('div', null, input),
        read: () => (typed ? { errors: { '': 'nope' } } : {}),
        setErrors: () => '',
        error: () => '',
        dirty: () => typed,
        focus() {},
        revert() {
          typed = false;
        },
        rebase() {},
      };
    },
  });
}
