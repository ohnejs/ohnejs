import { deepStrictEqual, notStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { isUndefined } from '../../../src/utils/is/is-undefined.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from '../ui/_events.ts';
import { inputOf, type } from './_controls.ts';

const { field } = await import('../../../src/dashboard/fields/known-field-types.ts');
const { fieldInput, form } = await import('../../../src/dashboard/fields/form.ts');
const { hasUnsavedChanges } = await import('../../../src/dashboard/router/unsaved-changes.ts');
await import('../../../src/dashboard/fields/builtin/text.ts');
await import('../../../src/dashboard/fields/builtin/integer.ts');
await import('../../../src/dashboard/fields/builtin/select.ts');
await import('../../../src/dashboard/fields/builtin/multi-select.ts');

const fields = {
  leader: field('text', { max: 12 }),
  motto: field('text', { nullable: true }),
  realm: field('text', { default: 'Stormrage' }),
};

/**
 * Every `input` under `root`, in order.
 */
function inputs(root: HTMLElement): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (node: FakeElement): void => {
    for (const child of node.childNodes) {
      if (!(child as FakeElement).tagName) continue;
      if ((child as FakeElement).tagName === 'INPUT') found.push(child as FakeElement);
      walk(child as FakeElement);
    }
  };
  walk(root as unknown as FakeElement);
  return found;
}

/**
 * Runs `test` in a scope it disposes after, so no form outlives its test.
 */
function scoped(test: () => void): void {
  const scope = effectScope();
  try {
    scope.run(test);
  } finally {
    scope.dispose();
  }
}

describe('form', () => {
  it('seeds defaults and empty values, and reads every required field', () => {
    scoped(() => {
      const raid = form({ fields });
      deepStrictEqual(structuredClone(raid.read()), { errors: { leader: 'validation.required' } });
      type(inputs(raid.element)[0] as FakeElement, 'Thrall');
      deepStrictEqual(raid.read(), {
        value: { leader: 'Thrall', motto: null, realm: 'Stormrage' },
      });
    });
  });

  it('reads a nullable field emptied by the user as `null`', () => {
    scoped(() => {
      const raid = form({ fields, data: () => ({ leader: 'Thrall', motto: 'Lok-tar' }) });
      flush();
      const [, motto] = inputs(raid.element);
      type(motto as FakeElement, '');
      deepStrictEqual(raid.read(), {
        value: { leader: 'Thrall', motto: null, realm: 'Stormrage' },
      });
      deepStrictEqual(raid.readPatch(), { value: { motto: null } });
    });
  });

  it('reads a cleared defaulted field as its default, as the server would store it', () => {
    scoped(() => {
      const raid = form({ fields: { count: field('integer', { default: 1 }) } });
      type(inputOf(raid.element), '7');
      type(inputOf(raid.element), '');
      deepStrictEqual(raid.read(), { value: { count: 1 } });
      deepStrictEqual(raid.readPatch(), { value: { count: 1 } });
    });
  });

  it('renders skeleton rows until `data` answers, then follows each answer', () => {
    scoped(() => {
      const answer = ref<{ leader: string; motto: string | null } | undefined>(undefined);
      const raid = form({ fields, data: () => answer.value });
      flush();
      strictEqual(raid.element.getAttribute('aria-busy'), 'true');
      deepStrictEqual(raid.read(), { errors: {} });

      answer.value = { leader: 'Thrall', motto: null };
      flush();
      strictEqual(raid.element.getAttribute('aria-busy'), null);
      deepStrictEqual(raid.value(), { leader: 'Thrall', motto: null, realm: 'Stormrage' });

      answer.value = { leader: 'Cairne', motto: null };
      flush();
      strictEqual(raid.value().leader, 'Cairne');

      const [leader] = inputs(raid.element);
      type(leader as FakeElement, 'Vol’jin');
      answer.value = { leader: 'Garrosh', motto: null };
      flush();
      strictEqual(raid.value().leader, 'Vol’jin');
      strictEqual(raid.dirty(), true);
      raid.revert();
      flush();
      strictEqual(raid.value().leader, 'Garrosh');
    });
  });

  it('keeps an edited choice and list through a refetch', () => {
    scoped(() => {
      const answer = ref<{ role: 'tank' | 'healer'; tags: string[] }>({
        role: 'tank',
        tags: ['raid', 'pvp'],
      });
      const party = form({
        fields: {
          role: field('select', { choices: ['tank', 'healer'], display: 'buttons' }),
          tags: field('multiSelect'),
        },
        data: () => answer.value,
      });
      flush();
      const root = party.element as unknown as FakeElement;
      const healer = findElement(
        root,
        (node) => node.textContent === 'healer' && hasClass(node, 'ohne-button-group-item'),
      );
      fire(healer as FakeElement, 'click');
      fire(
        findElement(root, (node) => hasClass(node, 'ohne-chips-remove')) as FakeElement,
        'click',
      );
      flush();
      deepStrictEqual(party.value(), { role: 'healer', tags: ['pvp'] });

      answer.value = { role: 'tank', tags: ['raid', 'pvp'] };
      flush();
      strictEqual(party.dirty(), true);
      deepStrictEqual(party.value(), { role: 'healer', tags: ['pvp'] });
    });
  });

  it('merges a saved patch into the baseline, so the saved fields read clean', () => {
    scoped(() => {
      const raid = form({ fields, data: () => ({ leader: 'Thrall', motto: null }) });
      flush();
      const [leader] = inputs(raid.element);
      type(leader as FakeElement, 'Rexxar');
      strictEqual(raid.dirty(), true);
      raid.rebase({ leader: 'Rexxar' });
      strictEqual(raid.dirty(), false);
      deepStrictEqual(raid.readPatch(), { value: {} });
    });
  });

  it('shows the messages of a failed `read` and `readPatch` on their rows', () => {
    scoped(() => {
      const raid = form({ fields });
      raid.read();
      flush();
      strictEqual(raid.element.textContent.includes('validation.required'), true);
      type(inputs(raid.element)[0] as FakeElement, 'Thrall of the Horde');
      deepStrictEqual(structuredClone(raid.readPatch()), {
        errors: { leader: 'validation.maxLength' },
      });
      flush();
      strictEqual(raid.element.textContent.includes('validation.maxLength'), true);
    });
  });

  it('places server messages and returns the first it cannot place', () => {
    scoped(() => {
      const raid = form({ fields });
      strictEqual(raid.setErrors({ leader: 'Taken', guild: 'Unknown guild' }), 'Unknown guild');
      flush();
      strictEqual(raid.element.textContent.includes('Taken'), true);
    });
  });

  it('disables its fieldset while busy and guards unsaved changes for its scope', () => {
    const scope = effectScope();
    scope.run(() => {
      const raid = form({ fields, data: () => ({ leader: 'Thrall', motto: null }) });
      flush();
      raid.setBusy(true);
      flush();
      strictEqual(raid.element.getAttribute('disabled'), '');
      type(inputs(raid.element)[0] as FakeElement, 'Jaina');
      strictEqual(hasUnsavedChanges(), true);
    });
    scope.dispose();
    strictEqual(hasUnsavedChanges(), false);
  });

  it('scopes its element ids, so two forms on one page never share one', () => {
    scoped(() => {
      const wirings = [form({ fields }), form({ fields })].map((raid) => {
        const input = inputOf(raid.element) as unknown as HTMLInputElement;
        const target = input.getAttribute('aria-labelledby');
        const label = findElement(
          raid.element as unknown as FakeElement,
          (node) => hasClass(node, 'ohne-label') && node.getAttribute('id') === target,
        );
        strictEqual(isUndefined(label), false);
        return { input: input.id, label: target };
      });
      notStrictEqual(wirings[0]?.input, wirings[1]?.input);
      notStrictEqual(wirings[0]?.label, wirings[1]?.label);
    });
  });

  it('throws on a layout that repeats a field', () => {
    scoped(() => {
      throws(() => form({ fields, layout: ['leader', 'leader'] }), /repeats field `leader`/);
    });
  });
});

describe('fieldInput', () => {
  it('writes each valid change to the model and keeps the last valid value otherwise', () => {
    scoped(() => {
      const leader = ref('Thrall');
      const element = fieldInput(leader, field('text', { label: 'Leader', max: 6 }));
      const input = inputOf(element);
      type(input, 'Rexxar');
      strictEqual(leader.value, 'Rexxar');
      type(input, 'Grommash');
      strictEqual(leader.value, 'Rexxar');
      strictEqual(element.textContent.includes('validation.maxLength'), true);
    });
  });

  it('shows an outside write and leaves the caret alone for its own echo', () => {
    scoped(() => {
      const leader = ref<string | null>('Thrall');
      const element = fieldInput(leader, field('text', { nullable: true }));
      const input = inputOf(element) as unknown as { value: string };
      type(inputOf(element), 'Rexxar');
      flush();
      strictEqual(input.value, 'Rexxar');
      leader.value = 'Cairne';
      flush();
      strictEqual(input.value, 'Cairne');
      type(inputOf(element), '');
      strictEqual(leader.value, null);
    });
  });

  it('renders the label the spec declares', () => {
    scoped(() => {
      const element = fieldInput(ref(''), field('text', { label: 'Guild' }));
      const label = findElement(element as unknown as FakeElement, (node) =>
        hasClass(node, 'ohne-label'),
      );
      strictEqual(label?.textContent, 'Guild');
    });
  });
});
