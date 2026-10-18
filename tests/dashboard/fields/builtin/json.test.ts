import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { type FakeElement, findElement } from '../../_fake-dom.ts';
import { type } from '../_controls.ts';

const { jsonType } = await import('../../../../src/dashboard/fields/builtin/json.ts');
const { fieldTypeFor } = await import('../../../../src/dashboard/fields/field-type.ts');

const field = (options: Record<string, unknown> = {}, nullable = false): DashboardField => ({
  name: 'talents',
  type: 'json',
  kind: 'column',
  logicalType: 'json',
  label: 'Talents',
  nullable,
  required: !nullable,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options,
});

/**
 * The control for `options`, seeded with `initial`.
 */
function control(
  options: Record<string, unknown> = {},
  initial: unknown = { spec: 'frost' },
  nullable = false,
) {
  return jsonType.control!({
    field: field(options, nullable),
    initial,
    mode: 'edit',
    path: 'talents',
    language: () => 'en',
    onInput() {},
  })!;
}

const areaOf = (root: unknown) =>
  findElement(root as FakeElement, (element) => element.tagName === 'TEXTAREA') as FakeElement;

const textOf = (root: unknown): string => (areaOf(root) as unknown as { value: string }).value;

const cell = (value: unknown) =>
  (
    jsonType.display!({ field: field(), value: () => value } as never) as unknown as () =>
      | FakeElement
      | string
  )() as FakeElement;

describe('jsonType control', () => {
  it('seeds the value pretty-printed and reads it clean', () => {
    effectScope().run(() => {
      const talents = control();
      strictEqual(textOf(talents.element), '{\n  "spec": "frost"\n}');
      strictEqual(talents.dirty(), false);
      deepStrictEqual(talents.read(), { value: { spec: 'frost' } });
    });
  });

  it('reads any JSON, a top-level scalar included', () => {
    effectScope().run(() => {
      const talents = control();
      type(areaOf(talents.element), '"unholy"');
      deepStrictEqual(talents.read(), { value: 'unholy' });
      type(areaOf(talents.element), '[1, null]');
      deepStrictEqual(talents.read(), { value: [1, null] });
      strictEqual(talents.dirty(), true);
    });
  });

  it('refuses text that does not parse, and a value deeper than `maxDepth`', () => {
    effectScope().run(() => {
      const talents = control({ maxDepth: 1 });
      type(areaOf(talents.element), '{ spec: ');
      strictEqual(talents.dirty(), true);
      deepStrictEqual(talents.read(), { errors: { '': 'validation.invalidJSON' } });
      type(areaOf(talents.element), '[[1]]');
      deepStrictEqual(talents.read(), { errors: { '': 'validation.maxDepth' } });
      type(areaOf(talents.element), '[1e400]');
      deepStrictEqual(talents.read(), { errors: { '': 'validation.invalidJSON' } });
    });
  });

  it('leaves the stored value unchecked while it is unchanged', () => {
    effectScope().run(() => {
      const talents = control({ maxDepth: 0 }, [[1]]);
      deepStrictEqual(talents.read(), { value: [[1]] });
    });
  });

  it('writes `null` for an emptied nullable field, and omits an emptied one otherwise', () => {
    effectScope().run(() => {
      const nullable = control({}, { spec: 'frost' }, true);
      type(areaOf(nullable.element), '  ');
      deepStrictEqual(nullable.read(), { value: null });
      const required = control();
      type(areaOf(required.element), '');
      deepStrictEqual(required.read(), {});
      strictEqual(required.dirty(), true);
    });
  });

  it('reads nothing while pristine over no value', () => {
    effectScope().run(() => {
      const fresh = jsonType.control!({
        field: field(),
        initial: undefined,
        mode: 'create',
        path: 'talents',
        language: () => 'en',
        onInput() {},
      })!;
      strictEqual(textOf(fresh.element), '');
      strictEqual(fresh.dirty(), false);
      deepStrictEqual(fresh.read(), {});
      strictEqual(fresh.draft?.(), undefined);
    });
  });

  it('answers the stored value when an edit only moves keys or whitespace', () => {
    effectScope().run(() => {
      const stored = { spec: 'frost', rank: 3 };
      const talents = control({}, stored);
      type(areaOf(talents.element), '{"rank":3,   "spec":"frost"}');
      strictEqual(talents.dirty(), false);
      strictEqual(talents.draft?.(), stored);
      strictEqual(talents.read().value, stored);
    });
  });

  it('drafts the last value that parsed while the text does not', () => {
    effectScope().run(() => {
      const talents = control();
      type(areaOf(talents.element), '{ "spec": "blood" }');
      type(areaOf(talents.element), '{ "spec": "blood", ');
      deepStrictEqual(talents.draft?.(), { spec: 'blood' });
      type(areaOf(talents.element), '[[[1]]]');
      deepStrictEqual(talents.draft?.(), [[[1]]]);
    });
  });

  it('restores a value into the same editor, dirty against the stored one', () => {
    effectScope().run(() => {
      const talents = control();
      const area = areaOf(talents.element);
      talents.restore?.({ spec: 'unholy' });
      flush();
      strictEqual(areaOf(talents.element), area);
      strictEqual(textOf(talents.element), '{\n  "spec": "unholy"\n}');
      strictEqual(talents.dirty(), true);
      type(area, '{ "spec": ');
      deepStrictEqual(talents.draft?.(), { spec: 'unholy' });
      talents.restore?.(undefined);
      flush();
      strictEqual(textOf(talents.element), '');
    });
  });

  it('keeps the text on rebase and re-seeds it on revert', () => {
    effectScope().run(() => {
      const talents = control();
      type(areaOf(talents.element), '{"spec":"unholy"}');
      talents.rebase({ spec: 'unholy' });
      strictEqual(textOf(talents.element), '{"spec":"unholy"}');
      strictEqual(talents.dirty(), false);
      type(areaOf(talents.element), '{');
      talents.revert();
      flush();
      strictEqual(textOf(talents.element), '{\n  "spec": "unholy"\n}');
      strictEqual(talents.dirty(), false);
    });
  });

  it('routes a server message to itself', () => {
    effectScope().run(() => {
      const talents = control();
      strictEqual(talents.setErrors({ '': 'Too deep', 'a.b': 'Elsewhere' }), 'Elsewhere');
      strictEqual(talents.error(), 'Too deep');
      type(areaOf(talents.element), '{}');
      strictEqual(talents.error(), '');
    });
  });
});

describe('jsonType display', () => {
  it('shows compact mono JSON with the full text as its title', () => {
    const shown = cell({ spec: 'frost', ranks: [1, 2] });
    strictEqual(shown.getAttribute('class'), 'ohne-truncate cell-mono');
    strictEqual(shown.getAttribute('title'), '{"spec":"frost","ranks":[1,2]}');
  });

  it('shows a dim mark for no value, and a top-level scalar as JSON', () => {
    strictEqual(cell(null).getAttribute('class'), 'cell-dim');
    strictEqual(cell('frost').getAttribute('title'), '"frost"');
  });
});

describe('json column fallback', () => {
  it('edits an unregistered json column type as `json`', () => {
    strictEqual(fieldTypeFor({ ...field(), type: 'settings' }), jsonType);
  });
});
