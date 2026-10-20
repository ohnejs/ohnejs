import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DashboardField } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement } from '../../_fake-dom.ts';
import { fire } from '../../ui/_events.ts';
import { inputOf, type } from '../_controls.ts';

const { slugType } = await import('../../../../src/dashboard/fields/builtin/slug.ts');
const { createFieldForm } = await import('../../../../src/dashboard/fields/field-form.ts');
const { h } = await import('../../../../src/dashboard/render/h.ts');
await import('../../../../src/dashboard/fields/builtin/text.ts');

const field = (options: Record<string, unknown> = {}, nullable = false): DashboardField => ({
  name: 'slug',
  type: 'slug',
  kind: 'column',
  label: 'Slug',
  nullable,
  required: !nullable,
  unique: true,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
  options,
});

/**
 * The control for `options` seeded with `initial`, its sibling `title` read from a live ref.
 */
function control(options: Record<string, unknown>, initial: unknown, title = ref<unknown>('')) {
  const scope = {
    get title() {
      return title.value;
    },
  };
  return slugType.control!({
    field: field(options),
    initial,
    mode: initial === undefined ? 'create' : 'edit',
    path: 'slug',
    language: () => 'en',
    ancestors: () => [scope],
    onInput() {},
  })!;
}

const text = (root: unknown): string => (inputOf(root) as unknown as { value: string }).value;
const toggleOf = (root: unknown) =>
  findElement(root as FakeElement, (element) => element.attributes.has('aria-pressed'))!;

describe('slugType control', () => {
  it('follows its sibling on a new record, live', () => {
    effectScope().run(() => {
      const title = ref<unknown>('The Fall of Arthas');
      const slug = control({ from: 'title' }, undefined, title);
      flush();
      strictEqual(text(slug.element), 'the-fall-of-arthas');
      title.value = 'Wrath of the Lich King';
      flush();
      strictEqual(text(slug.element), 'wrath-of-the-lich-king');
      deepStrictEqual(slug.read(), { value: 'wrath-of-the-lich-king' });
      strictEqual(toggleOf(slug.element).getAttribute('aria-pressed'), 'true');
    });
  });

  it('unlinks on typing, and the toggle relinks and derives again', () => {
    effectScope().run(() => {
      const title = ref<unknown>('Icecrown');
      const slug = control({ from: 'title' }, undefined, title);
      flush();
      type(inputOf(slug.element), 'citadel');
      title.value = 'Ulduar';
      flush();
      strictEqual(text(slug.element), 'citadel');
      strictEqual(toggleOf(slug.element).getAttribute('aria-pressed'), 'false');
      fire(toggleOf(slug.element), 'click');
      flush();
      strictEqual(text(slug.element), 'ulduar');
    });
  });

  it('starts an existing slug unlinked', () => {
    effectScope().run(() => {
      const slug = control({ from: 'title' }, 'arthas', ref<unknown>('Something Else'));
      flush();
      strictEqual(text(slug.element), 'arthas');
      strictEqual(slug.dirty(), false);
    });
  });

  it('reads the canonical form before blur, and writes it on blur', () => {
    effectScope().run(() => {
      const slug = control({}, 'old');
      type(inputOf(slug.element), 'Über Uns ');
      deepStrictEqual(slug.read(), { value: 'uber-uns' });
      fire(inputOf(slug.element), 'blur');
      flush();
      strictEqual(text(slug.element), 'uber-uns');
    });
  });

  it('keeps `/` only in a nested slug', () => {
    effectScope().run(() => {
      const flat = control({}, 'x');
      type(inputOf(flat.element), 'Docs/Install');
      deepStrictEqual(flat.read(), { value: 'docs-install' });
      const nested = control({ nested: true }, 'x');
      type(inputOf(nested.element), 'Docs/Install');
      deepStrictEqual(nested.read(), { value: 'docs/install' });
    });
  });

  it('refuses a changed slug with nothing Latin in it', () => {
    effectScope().run(() => {
      const slug = control({}, 'arthas');
      type(inputOf(slug.element), 'Привет');
      deepStrictEqual(slug.read(), { errors: { '': 'validation.invalidSlug' } });
    });
  });

  it('starts an existing record without a slug unlinked, so opening it changes nothing', () => {
    effectScope().run(() => {
      const slug = control({ from: 'title' }, null, ref<unknown>('Ulduar'));
      flush();
      strictEqual(text(slug.element), '');
      strictEqual(slug.dirty(), false);
      strictEqual(toggleOf(slug.element).getAttribute('aria-pressed'), 'false');
    });
  });

  it('reads untouched while following an empty sibling, as a locale with no row does', () => {
    effectScope().run(() => {
      const slug = control({ from: 'title' }, null, ref<unknown>(null));
      flush();
      strictEqual(slug.dirty(), false);
      deepStrictEqual(slug.read(), { value: null });
    });
  });

  it('stops following once a save rebases it on a stored slug', () => {
    effectScope().run(() => {
      const title = ref<unknown>('Naxxramas');
      const slug = control({ from: 'title' }, undefined, title);
      flush();
      slug.rebase('naxxramas');
      title.value = 'Karazhan';
      flush();
      strictEqual(text(slug.element), 'naxxramas');
    });
  });
});

describe('slugType in a form', () => {
  const titleField = (options: Record<string, unknown> = {}): DashboardField => ({
    ...field(),
    name: 'title',
    type: 'text',
    unique: false,
    nullable: true,
    required: false,
    options,
  });
  const form = (
    initial: Record<string, unknown> | undefined,
    title: DashboardField = titleField(),
  ) =>
    createFieldForm([title, field({ from: 'title' })], initial, {
      mode: initial === undefined ? 'create' : 'edit',
      path: '',
      language: () => 'en',
    });
  const pressed = (built: ReturnType<typeof form>) =>
    toggleOf(built.controlOf('slug')!.element).getAttribute('aria-pressed');

  it('reads an untouched create form clean when the source has a default', () => {
    effectScope().run(() => {
      const built = form(undefined, titleField({ default: 'Untitled' }));
      h('div', null, built.render());
      flush();
      strictEqual(built.dirty(), false);
    });
  });

  it('keeps following through an undo of a source edit', () => {
    effectScope().run(() => {
      const built = form(undefined);
      h('div', null, built.render());
      flush();
      type(inputOf(built.controlOf('title')!.element), 'Hello');
      flush();
      const step = built.draft();
      type(inputOf(built.controlOf('title')!.element), 'Hello World');
      flush();
      built.restore(step);
      flush();
      strictEqual(pressed(built), 'true');
      type(inputOf(built.controlOf('title')!.element), 'Goodbye');
      flush();
      strictEqual(text(built.controlOf('slug')!.element), 'goodbye');
    });
  });

  it('lands on the stored slug after a save that left an idle one', () => {
    effectScope().run(() => {
      const built = form({ title: 'Hello', slug: 'custom' });
      h('div', null, built.render());
      flush();
      fire(toggleOf(built.controlOf('slug')!.element), 'click');
      type(inputOf(built.controlOf('title')!.element), '');
      flush();
      built.rebase({ title: null, slug: 'custom' });
      flush();
      const slug = built.controlOf('slug')!;
      strictEqual(text(slug.element), 'custom');
      strictEqual(slug.dirty(), false);
      deepStrictEqual(slug.read(), { value: 'custom' });
    });
  });
});

describe('slugType editor', () => {
  it('clears a nullable slug to `null`, and refuses an empty required one', () => {
    for (const nullable of [true, false]) {
      const commits: unknown[] = [];
      const input = slugType.editor!({
        field: field({}, nullable),
        value: () => 'arthas',
        commit: (next: unknown) => void commits.push(next),
        cancel() {},
      } as never) as unknown as FakeElement & { value: string };
      input.value = '';
      fire(input, 'keydown', { key: 'Enter', preventDefault() {} });
      deepStrictEqual(commits, nullable ? [null] : []);
    }
  });
});

describe('slugType filter', () => {
  const filterInput = (nested: boolean, operator: string, initial: string) => {
    const value = ref(initial);
    const element = slugType.filter!.input({
      field: field({ nested }),
      operator: () => operator,
      value: () => value.value,
      set: (next: unknown) => {
        value.value = String(next);
      },
      commit() {},
      inputID: 'slug',
      language: () => 'en',
    } as never);
    fire(inputOf(element), 'blur');
    return value.value;
  };

  it('canonicalizes on blur, keeping the slashes of a nested part', () => {
    strictEqual(filterInput(true, 'startsWith', 'Docs/'), 'docs/');
    strictEqual(filterInput(true, 'eq', 'Docs/Install/'), 'docs/install');
    strictEqual(filterInput(false, 'contains', 'AC/DC'), 'ac-dc');
  });
});
