import { deepStrictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { baseBrowser } from '../_browser.ts';

type Popup = typeof import('../../../../src/base/dashboard/components/filter-popup.ts');

const FILTER = { operators: () => ['eq' as const], seed: () => '', input: () => null };

function described(name: string, extra: Partial<DashboardField> = {}): DashboardField {
  return {
    name,
    type: 'text',
    kind: 'column',
    label: name,
    nullable: false,
    required: false,
    unique: false,
    translatable: false,
    readable: true,
    writable: true,
    immutable: false,
    logicalType: 'text',
    ...extra,
  };
}

function composite(name: string, subfields: DashboardField[]): DashboardField {
  return described(name, {
    type: 'object',
    kind: 'childOne',
    nullable: true,
    logicalType: undefined,
    subfields: [described('UUID', { type: null }), ...subfields],
  });
}

describe('filterCandidates', () => {
  let popup!: Popup;

  before(async () => {
    baseBrowser('/collections/events');
    const { registerUntypedFieldType } =
      await import('../../../../src/dashboard/fields/field-type.ts');
    registerUntypedFieldType('text', { display: () => null, filter: FILTER });
    registerUntypedFieldType('object', { display: () => null, filter: FILTER });
    popup = await import('../../../../src/base/dashboard/components/filter-popup.ts');
  });

  const candidates = (fields: DashboardField[]) =>
    popup.filterCandidates(fields).map(({ name, label, field }) => [name, label, field.name]);

  it('offers each part of an object under a dotted name and a joined label, never its `UUID`', () => {
    deepStrictEqual(
      candidates([
        described('title'),
        composite('period', [described('start'), described('end')]),
        described('UUID', { type: null }),
      ]),
      [
        ['period.end', 'period > end', 'end'],
        ['period.start', 'period > start', 'start'],
        ['title', 'title', 'title'],
        ['UUID', 'UUID', 'UUID'],
      ],
    );
  });

  it('recurses a nested object and skips a hidden composite or part', () => {
    deepStrictEqual(
      candidates([
        composite('seo', [
          described('secret', { readable: false }),
          composite('og', [described('title')]),
        ]),
        { ...composite('hidden', [described('title')]), readable: false },
      ]),
      [['seo.og.title', 'seo > og > title', 'title']],
    );
  });

  it('never flattens a repeater or a field whose type has no filter', () => {
    deepStrictEqual(
      candidates([
        described('steps', { type: 'repeater', kind: 'childMany', subfields: [described('x')] }),
        described('blob', { type: 'json', logicalType: 'json' }),
      ]),
      [],
    );
  });
});
