import { strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { facts } = await import('../../../src/dashboard/ui/facts.ts');

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

function fake(element: HTMLElement): FakeElement {
  return element as unknown as FakeElement;
}

describe('facts', () => {
  it('lists each label over its value in a `dl`', () => {
    const element = fake(
      facts([
        { label: 'Faction', value: 'Horde' },
        { label: 'Home', value: 'Orgrimmar' },
      ]),
    );
    strictEqual(element.tagName, 'DL');
    strictEqual(element.getAttribute('class'), 'ohne-facts ohne-facts-auto');
    const first = findElement(element, (el) => hasClass(el, 'ohne-fact'))!;
    const [label, value] = first.childNodes as FakeElement[];
    strictEqual(label!.tagName, 'DT');
    strictEqual(value!.tagName, 'DD');
    strictEqual(element.textContent, 'FactionHordeHomeOrgrimmar');
  });

  it('flows in the requested columns', () => {
    strictEqual(hasClass(fake(facts([], { columns: 2 })), 'ohne-facts-2'), true);
  });

  it('holds placeholders while the rows load', () => {
    const rows = ref<{ label: string; value: string }[] | undefined>(undefined);
    const element = fake(facts(() => rows.value));
    strictEqual(
      findElement(element, (el) => el.tagName === 'DT'),
      undefined,
    );
    strictEqual(
      hasClass(findElement(element, (el) => hasClass(el, 'ohne-fact'))!, 'ohne-fact'),
      true,
    );
    rows.value = [{ label: 'Faction', value: 'Alliance' }];
    flush();
    strictEqual(element.textContent, 'FactionAlliance');
  });
});
