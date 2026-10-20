import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { field } from '../../../src/dashboard/fields/known-field-types.ts';
import { specField } from '../../../src/dashboard/fields/spec-field.ts';

describe('specField', () => {
  it('describes a plain spec as a required column with a sentence-cased label', () => {
    deepStrictEqual(specField('raidLeader', field('text', { max: 12 })), {
      name: 'raidLeader',
      type: 'text',
      kind: 'column',
      label: 'Raid leader',
      nullable: false,
      required: true,
      unique: false,
      translatable: false,
      readable: true,
      writable: true,
      immutable: false,
      options: { max: 12 },
    });
  });

  it('marks a spec optional when something fills it without input', () => {
    strictEqual(specField('motto', field('text', { nullable: true })).required, false);
    strictEqual(specField('realm', field('text', { default: 'Stormrage' })).required, false);
    strictEqual(specField('realm', field('text', { when: { heroic: true } })).required, false);
    strictEqual(specField('tags', field('multiSelect')).required, false);
    strictEqual(specField('bosses', field('records', { collection: 'Users' })).required, false);
    strictEqual(
      specField('bosses', field('records', { collection: 'Users', allowEmpty: false })).required,
      true,
    );
  });

  it('starts a spec without a default from its empty value', () => {
    deepStrictEqual(specField('motto', field('text', { nullable: true })).options, {
      default: null,
    });
    deepStrictEqual(specField('note', field('text', { allowEmpty: true })).options, {
      allowEmpty: true,
      default: '',
    });
    deepStrictEqual(specField('tags', field('multiSelect')).options, { default: [] });
    strictEqual(specField('leader', field('text')).options, undefined);
  });

  it('seeds no empty value the server rejects, so the spec stays required', () => {
    const forbidden = {
      tags: field('multiSelect', { min: 1 }),
      roster: field('repeater', { min: 2, fields: { name: field('text') } }),
      bosses: field('records', { collection: 'Users', allowEmpty: false }),
      code: field('text', { allowEmpty: true, min: 3 }),
    };
    for (const [name, spec] of Object.entries(forbidden)) {
      const described = specField(name, spec);
      strictEqual(described.required, true, name);
      strictEqual(described.options?.default, undefined, name);
    }
    deepStrictEqual(specField('tags', field('multiSelect', { min: 0 })).options, {
      min: 0,
      default: [],
    });
  });

  it('maps relations and composites onto their wire kinds', () => {
    const boss = specField('boss', field('record', { collection: 'Users' }));
    strictEqual(boss.kind, 'record');
    strictEqual(boss.target, 'Users');
    const roster = specField(
      'roster',
      field('repeater', {
        fields: { name: field('text'), level: field('integer') },
        layout: [{ row: ['name', 'level'] }],
      }),
    );
    strictEqual(roster.kind, 'childMany');
    deepStrictEqual(
      roster.subfields?.map((sub) => sub.name),
      ['name', 'level'],
    );
    deepStrictEqual(roster.layout, [
      {
        kind: 'row',
        nodes: [
          { kind: 'field', name: 'name' },
          { kind: 'field', name: 'level' },
        ],
      },
    ]);
    strictEqual(specField('bank', field('object', { fields: {} })).kind, 'childOne');
  });

  it('describes a range as a one-child composite, required unless nullable', () => {
    const window = specField('window', field('range', { of: 'date', minSpan: '1 day' }));
    strictEqual(window.kind, 'childOne');
    strictEqual(window.required, true);
    deepStrictEqual(window.options, { of: 'date', minSpan: '1 day' });
    const open = specField('open', field('range', { of: 'dateTime', nullable: true }));
    strictEqual(open.required, false);
    strictEqual(open.options?.default, null);
    const price = specField(
      'price',
      field('range', { of: 'integer', display: 'slider', min: 0, max: 9 }),
    );
    deepStrictEqual(price.options, { of: 'integer', display: 'slider', min: 0, max: 9 });
  });

  it('splits an expandable description and fills its toggle labels', () => {
    const lore = specField('lore', field('text', { description: { text: 'The **long** tale' } }));
    deepStrictEqual(lore.expandable, {
      text: 'The **long** tale',
      showLabel: 'dashboard.field.showDescription',
      hideLabel: 'dashboard.field.hideDescription',
      expanded: false,
    });
    strictEqual(lore.description, undefined);
  });

  it('takes the stand-in label when the spec declares none', () => {
    strictEqual(specField('input-1', field('text'), '').label, '');
    strictEqual(specField('input-1', field('text', { label: 'Guild' }), '').label, 'Guild');
  });
});
