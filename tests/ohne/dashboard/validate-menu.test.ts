import { deepStrictEqual, doesNotThrow, ok, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { validateMenu } from '../../../src/ohne/dashboard/validate-menu.ts';
import { isOhneError } from '../../../src/ohne/error/ohne-error.ts';

const file = '/app/ohne.config.ts';

/**
 * The block `validateMenu` throws for `menu`.
 */
function refusal(menu: unknown): { title?: string; body: unknown; path?: string } {
  let block: { title?: string; body: unknown; path?: string } | undefined;
  throws(
    () => validateMenu(menu, file),
    (error: unknown) => {
      ok(isOhneError(error));
      block = { title: error.title, body: error.body, path: error.path };
      return true;
    },
  );
  return block!;
}

describe('validateMenu', () => {
  it('accepts well-formed nodes, an absent menu, and an absent node', () => {
    doesNotThrow(() =>
      validateMenu(
        {
          shop: { order: 2, label: { key: 'menu.shop', params: { n: 1 } } },
          sales: { parent: 'shop', to: '/sales', label: 'Sales', icon: 'coin', can: 'sales.read' },
          overview: { parent: null, hidden: true },
          Posts: undefined,
        },
        file,
      ),
    );
    doesNotThrow(() => validateMenu(undefined, file));
  });

  it('refuses a menu that is not an object, on its file', () => {
    deepStrictEqual(refusal([{ items: [] }]).path, file);
  });

  it('refuses an unknown key, suggesting the nearest one', () => {
    deepStrictEqual(refusal({ sales: { parnet: 'shop' } }), {
      title: 'Invalid menu node `sales`',
      body: ['`parnet` is not a menu node key.', '', 'Did you mean `parent`?'],
      path: file,
    });
  });

  it('refuses each malformed field', () => {
    const rows = [
      [{ parent: 1 }, '`parent` is the id of another node, or `null` for the root.'],
      [{ order: Infinity }, '`order` is a finite number.'],
      [{ label: 3 }, '`label` is a message: a string, or a `{ key, params }` object.'],
      [{ to: 'reports' }, '`to` is a dashboard path that starts with `/`, like `/reports`.'],
      [{ to: '//evil.com' }, '`to` is a dashboard path that starts with `/`, like `/reports`.'],
      [{ can: true }, '`can` is a capability, like `reports.read`.'],
      [{ hidden: 'yes' }, '`hidden` is `true` or `false`.'],
    ] as const;
    for (const [node, row] of rows) deepStrictEqual(refusal({ x: node }).body, [row]);
  });

  it('refuses an icon the set does not carry, on its file', () => {
    const { title, path } = refusal({ sales: { icon: 'coins-nope' } });
    deepStrictEqual([title, path], ['Unknown icon `coins-nope`', file]);
  });
});
