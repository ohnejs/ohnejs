import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSpec, FormValue } from '../../../src/dashboard/fields/known-field-types.ts';

import { field } from '../../../src/dashboard/fields/known-field-types.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';

declare module '../../../src/dashboard/fields/known-field-types.ts' {
  interface KnownFieldTypes {
    rating: { options: { max?: number }; value: number };
    sigil: { options: {}; value: string };
  }
}

declare const fieldInput: typeof import('../../../src/dashboard/fields/form.ts').fieldInput;
declare const form: typeof import('../../../src/dashboard/fields/form.ts').form;
declare const registerFieldType: typeof import('../../../src/dashboard/fields/field-type.ts').registerFieldType;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Compiles only when `A` and `B` are the same type.
 */
function assertType<A, B>(_proof: Equal<A, B>): void {}

const raid = {
  leader: field('text', { label: 'Raid leader', max: 40 }),
  motto: field('text', { nullable: true }),
  faction: field('select', { choices: ['horde', 'alliance'], default: 'horde' }),
  realm: field('select', {
    choices: [
      { value: 'stormrage', label: 'Stormrage' },
      { value: 'illidan', label: () => 'Illidan' },
    ],
    when: { faction: 'horde' },
  }),
  heroic: field('boolean', { display: 'switch', default: false }),
  size: field('integer', { min: 10, max: 40 }),
  roster: field('repeater', {
    fields: {
      name: field('text'),
      roles: field('multiSelect', { choices: ['tank', 'healer', 'damage'] }),
      level: field('integer', { nullable: true }),
    },
  }),
  quartermaster: field('object', { fields: { gold: field('number') } }),
  tags: field('multiSelect'),
  stars: field('rating', { max: 5 }),
  crest: field('sigil'),
};

type Raid = FormValue<typeof raid>;

describe('field', () => {
  it('returns the type and the options as plain data', () => {
    deepStrictEqual(field('text', { max: 3 }), { type: 'text', options: { max: 3 } });
    deepStrictEqual(field('boolean'), { type: 'boolean', options: {} });
  });

  it('narrows choices, nests composites, and adds `null` for a nullable field', () => {
    assertType<
      Raid,
      {
        leader: string;
        motto: string | null;
        faction: 'horde' | 'alliance';
        realm?: 'stormrage' | 'illidan';
        heroic: boolean;
        size: number;
        roster: { name: string; roles: ('tank' | 'healer' | 'damage')[]; level: number | null }[];
        quartermaster: { gold: number };
        tags: string[];
        stars: number;
        crest: string;
      }
    >(true);
  });

  it('types a spec with the options as written', () => {
    assertType<
      typeof raid.faction,
      FieldSpec<'select', { readonly choices: ['horde', 'alliance']; readonly default: 'horde' }>
    >(true);
  });

  it('rejects options the type does not declare', () => {
    // @ts-expect-error `select` requires `choices`.
    field('select');
    // @ts-expect-error `select` requires `choices`, even beside other options.
    field('select', { label: 'Faction' });
    // @ts-expect-error `text` has no `maxx` option.
    field('text', { maxx: 3 });
    // @ts-expect-error `required` is derived, never declared.
    field('text', { required: true });
    // @ts-expect-error `dragon` is no registered field type.
    field('dragon');
  });

  it('checks a default against the value type', () => {
    // @ts-expect-error `murloc` is not one of the choices.
    field('select', { choices: ['horde', 'alliance'], default: 'murloc' });
    // @ts-expect-error An integer defaults to a number.
    field('integer', { default: 'forty' });
    // @ts-expect-error A non-nullable field cannot default to `null`.
    field('text', { default: null });
    field('text', { nullable: true, default: null });
    field('multiSelect', { choices: ['tank', 'healer'], default: ['tank'] });
    field('repeater', {
      fields: { name: field('text') },
      default: [{ name: 'Thrall' }],
    });
  });

  it('takes a layer entry as a plain registry member', () => {
    field('rating');
    field('rating', { max: 5, label: 'Stars' });
    // @ts-expect-error `rating` declares no `min`.
    field('rating', { min: 1 });
  });
});

describe('fieldInput', () => {
  it('requires a ref of exactly the field value type', () => {
    const typed = (): void => {
      fieldInput(ref<'horde' | 'alliance'>('horde'), raid.faction);
      fieldInput(ref('horde'), raid.faction);
      fieldInput(ref(''), raid.leader);
      fieldInput(ref<string | null>(null), raid.motto);
      fieldInput(ref(5), raid.stars);
      // @ts-expect-error A plain string is wider than the choices.
      fieldInput(ref<string>('horde'), raid.faction);
      // @ts-expect-error `murloc` is not a choice.
      fieldInput(ref('murloc'), raid.faction);
      const free = ref('horde');
      // @ts-expect-error A free `Ref<string>` is wider than the choices.
      fieldInput(free, raid.faction);
      // @ts-expect-error A nested list holds the declared roles only.
      fieldInput(ref([{ name: 'Jaina', roles: ['mage'], level: 60 }]), raid.roster);
    };
    void typed;
  });
});

describe('form', () => {
  it('reads `FormValue` and checks layout names against the fields', () => {
    const typed = (): void => {
      const roster = form({
        fields: raid,
        layout: [{ row: ['leader', 'faction | auto'] }, 'motto', '---', { card: ['roster'] }],
      });
      const reading = roster.read();
      if (reading.errors === undefined) assertType<typeof reading.value, Raid>(true);
      assertType<ReturnType<typeof roster.value>, Partial<Raid>>(true);
      // @ts-expect-error `leaders` is no field of the form.
      form({ fields: raid, layout: ['leaders'] });
    };
    void typed;
  });
});

describe('registerFieldType', () => {
  it('types `field.options` by the registered name and refuses an unknown one', () => {
    const typed = (): void => {
      registerFieldType('rating', {
        display: ({ field }) => String(field.options?.max ?? 5),
      });
      registerFieldType('rating', {
        // @ts-expect-error `rating` declares no `min`.
        display: ({ field }) => String(field.options?.min),
      });
      // @ts-expect-error `dragon` has no `KnownFieldTypes` entry.
      registerFieldType('dragon', { display: () => null });
    };
    void typed;
  });
});
