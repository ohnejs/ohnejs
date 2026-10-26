import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../../_fake-dom.ts';
import { inputOf, type } from '../_controls.ts';

const { codeType } = await import('../../../../src/dashboard/fields/builtin/code.ts');
const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');
const { h } = await import('../../../../src/dashboard/render/h.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');

type Scopes = () => readonly Readonly<Record<string, unknown>>[];

const field = (options: Record<string, unknown> = {}, nullable = false): DashboardField => ({
  name: 'snippet',
  type: 'code',
  kind: 'column',
  label: 'Snippet',
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
 * The control for `options`, seeded with `initial`, inside the value scopes `ancestors` yields.
 */
function control(
  options: Record<string, unknown> = {},
  initial: unknown = 'const a = 1',
  nullable = false,
  ancestors?: Scopes,
) {
  return codeType.control!({
    field: field(options, nullable),
    initial,
    mode: 'edit',
    path: 'snippet',
    language: () => 'en',
    ancestors,
    onInput() {},
  })!;
}

const areaOf = (root: unknown) =>
  findElement(root as FakeElement, (element) => element.tagName === 'TEXTAREA') as FakeElement;

const highlighted = (root: unknown): boolean =>
  !!findElement(root as FakeElement, (element) =>
    (element.getAttribute('class') ?? '').startsWith('tk-'),
  );

const cell = (value: unknown) =>
  (
    codeType.display!({ field: field(), value: () => value } as never) as unknown as () =>
      | FakeElement
      | string
  )() as FakeElement;

describe('codeType control', () => {
  it('reads the typed text and is clean while it matches the stored value', () => {
    effectScope().run(() => {
      const snippet = control();
      strictEqual(snippet.dirty(), false);
      type(areaOf(snippet.element), 'let b = 2\nb += 1');
      strictEqual(snippet.dirty(), true);
      deepStrictEqual(snippet.read(), { value: 'let b = 2\nb += 1' });
      type(areaOf(snippet.element), 'const a = 1');
      strictEqual(snippet.dirty(), false);
    });
  });

  it('writes `null` for an emptied nullable field, and refuses an empty one otherwise', () => {
    effectScope().run(() => {
      const nullable = control({}, 'const a = 1', true);
      type(areaOf(nullable.element), '');
      deepStrictEqual(nullable.read(), { value: null });
      const required = control();
      type(areaOf(required.element), '');
      deepStrictEqual(required.read(), { errors: { '': 'validation.emptyValue' } });
    });
  });

  it('snapshots the emptied code its read refuses', () => {
    effectScope().run(() => {
      const required = control();
      type(areaOf(required.element), '');
      deepStrictEqual(
        [required.snapshot?.(), required.read()],
        ['', { errors: { '': 'validation.emptyValue' } }],
      );
    });
  });

  it('keeps a stored empty string on a nullable field, clean until edited', () => {
    effectScope().run(() => {
      const empty = control({ allowEmpty: true }, '', true);
      strictEqual(empty.dirty(), false);
      deepStrictEqual(empty.read(), { value: '' });
    });
  });

  it('parses a changed value under `language: json` only', () => {
    effectScope().run(() => {
      const json = control({ language: 'JSON' }, '{}');
      type(areaOf(json.element), '{ "a": ');
      deepStrictEqual(json.read(), { errors: { '': 'validation.invalidJSON' } });
      type(areaOf(json.element), '{ "a": 1 }');
      deepStrictEqual(json.read(), { value: '{ "a": 1 }' });
      const jsonc = control({ language: 'jsonc' }, '{}');
      type(areaOf(jsonc.element), '{ // open');
      deepStrictEqual(jsonc.read(), { value: '{ // open' });
    });
  });

  it('drafts the text as typed while it fails a check', () => {
    effectScope().run(() => {
      const json = control({ language: 'json', max: 8 }, '{}');
      type(areaOf(json.element), '{ "a": ');
      strictEqual(json.draft?.(), '{ "a": ');
      type(areaOf(json.element), '{ "a": 1234 }');
      strictEqual(json.draft?.(), '{ "a": 1234 }');
      deepStrictEqual(json.read(), { errors: { '': 'validation.maxLength' } });
      const fresh = codeType.control!({
        field: field(),
        initial: undefined,
        mode: 'create',
        path: 'snippet',
        language: () => 'en',
        onInput() {},
      })!;
      strictEqual(fresh.draft?.(), undefined);
    });
  });

  it('never parses JSON for an empty value the field allows', () => {
    effectScope().run(() => {
      const json = control({ language: 'json', allowEmpty: true }, '{}');
      type(areaOf(json.element), '');
      deepStrictEqual(json.read(), { value: '' });
    });
  });

  it('restores text into its editor, dirty against the stored value, so its check runs on read', () => {
    effectScope().run(() => {
      const json = control({ language: 'json' }, '{}');
      const area = areaOf(json.element);
      type(area, '{ "a": 1 }');
      json.restore?.('{ "a": ');
      flush();
      strictEqual(areaOf(json.element), area);
      strictEqual((area as unknown as { value: string }).value, '{ "a": ');
      strictEqual(json.dirty(), true);
      deepStrictEqual(json.read(), { errors: { '': 'validation.invalidJSON' } });
      json.restore?.('{}');
      strictEqual(json.dirty(), false);
      deepStrictEqual(json.read(), { value: '{}' });
    });
  });

  it('highlights in the language a sibling names, and follows it', () => {
    effectScope().run(() => {
      const file = ref('Posts.ts');
      const scope = {
        get path() {
          return file.value;
        },
      };
      const snippet = control({ languageFrom: 'path' }, 'const a = 1', false, () => [scope]);
      flush();
      strictEqual(highlighted(snippet.element), true);
      file.value = 'notes.txt';
      flush();
      strictEqual(highlighted(snippet.element), false);
    });
  });

  it('reads a `../` path through the enclosing scopes', () => {
    effectScope().run(() => {
      const snippet = control({ languageFrom: '../kind' }, 'const a = 1', false, () => [
        { kind: 'ts' },
        { kind: 'text' },
      ]);
      flush();
      strictEqual(highlighted(snippet.element), true);
    });
  });

  it('follows a sibling in a real form, whichever of the two comes first', () => {
    effectScope().run(() => {
      const path = { ...field(), name: 'path', type: 'text', options: {} };
      const snippet = field({ languageFrom: 'path' });
      for (const fields of [
        [path, snippet],
        [snippet, path],
      ]) {
        const form = createFieldForm(
          fields,
          { path: 'Posts.ts', snippet: 'const a = 1' },
          {
            mode: 'edit',
            path: '',
            language: () => 'en',
          },
        );
        const root = h('div', null, form.render());
        flush();
        strictEqual(highlighted(root), true);
        type(inputOf(form.controlOf('path')!.element), 'notes.txt');
        flush();
        strictEqual(highlighted(root), false);
      }
    });
  });

  it('renders plain without a language', () => {
    effectScope().run(() => {
      const snippet = control();
      flush();
      strictEqual(highlighted(snippet.element), false);
    });
  });
});

describe('codeType display', () => {
  it('shows the first line in mono with the line count beside it', () => {
    effectScope().run(() => {
      const many = cell('const a = 1\nconst b = 2');
      strictEqual(many.getAttribute('title'), 'const a = 1\nconst b = 2');
      const [first, count] = many.childNodes as FakeElement[];
      strictEqual(hasClass(first, 'cell-mono'), true);
      strictEqual(first.textContent, 'const a = 1');
      strictEqual(count.textContent, 'dashboard.code.lines');
      strictEqual(cell('const a = 1').childNodes.length, 1);
    });
  });

  it('shows the empty string as a faint `""`', () => {
    effectScope().run(() => {
      strictEqual(cell('').textContent, '""');
      strictEqual(hasClass(cell(''), 'cell-faint'), true);
    });
  });
});

describe('codeType summary', () => {
  it('digests the first line', () => {
    strictEqual(codeType.summary!('a\nb', field()), 'a');
    strictEqual(codeType.summary!(null, field()), '');
  });
});

describe('codeType filter', () => {
  it('offers the text search operators', () => {
    deepStrictEqual(codeType.filter!.operators(field()), ['contains', 'notContains']);
  });
});
