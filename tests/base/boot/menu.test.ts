import { deepStrictEqual, doesNotThrow, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { assertMenu } from '../../../src/base/boot/menu.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';
import { type Config, DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

type Menu = NonNullable<NonNullable<Config['dashboard']>['menu']>;

useLayers().add({ path: '/menu-boot-test', defaults: DEFAULTS });
useCollections().register('Posts', { name: 'Posts', collection: { fields: {} } });

/**
 * Runs the assert over `menu`, with `disabled` collections.
 */
function check(menu: Menu, disabled: string[] = []): void {
  useLayers().add({
    path: '/menu-boot-test-app',
    input: { dashboard: { menu }, disable: { collections: disabled } },
  });
  try {
    assertMenu();
  } finally {
    useLayers().remove('/menu-boot-test-app');
  }
}

/**
 * The block `assertMenu` throws for `menu`.
 */
function refusal(menu: Menu): { title: string; body: unknown } {
  let block: { title: string; body: unknown } | undefined;
  throws(
    () => check(menu),
    (error: unknown) => {
      ok(isOhneError(error));
      block = { title: error.title ?? '', body: error.body };
      return true;
    },
  );
  return block!;
}

describe('assertMenu', () => {
  it('accepts parents that name a node or a collection, and a collection without a label', () => {
    doesNotThrow(() =>
      check({
        shop: { label: 'Shop' },
        Posts: { parent: 'shop', to: '/posts' },
        sales: { parent: 'Posts', to: '/sales', label: 'Sales' },
        root: { parent: null, to: '/root', label: 'Root' },
      }),
    );
  });

  it('refuses an unknown parent, suggesting the nearest id', () => {
    deepStrictEqual(refusal({ shop: {}, sales: { parent: 'shpo', to: '/s', label: 'S' } }), {
      title: 'Menu node `sales` sits under unknown node `shpo`',
      body: ['No menu node or collection is named `shpo`.', '', 'Did you mean `shop`?'],
    });
  });

  it('accepts a disabled collection as a parent and as a node', () => {
    doesNotThrow(() =>
      check({ Gone: {}, log: { parent: 'Gone', to: '/log', label: 'Log' } }, ['Gone']),
    );
  });

  it('refuses a link that is not a collection and has no label', () => {
    deepStrictEqual(refusal({ reports: { to: '/reports' } }), {
      title: 'Menu link `reports` has no label',
      body: ['It opens `/reports`, but nothing names it in the sidebar.', 'Give it a `label`.'],
    });
  });

  it('refuses a node that sits under itself, naming the loop', () => {
    deepStrictEqual(refusal({ a: { parent: 'b' }, b: { parent: 'c' }, c: { parent: 'a' } }), {
      title: 'Menu node `a` sits under itself',
      body: [
        'Its parents loop back to it: `a` -> `b` -> `c` -> `a`.',
        'Point one `parent` elsewhere, or set it to `null`.',
      ],
    });
  });

  it('stops at a loop above a node, refusing it from the node inside it', () => {
    const { title } = refusal({ leaf: { parent: 'a' }, a: { parent: 'b' }, b: { parent: 'a' } });
    deepStrictEqual(title, 'Menu node `a` sits under itself');
  });
});
