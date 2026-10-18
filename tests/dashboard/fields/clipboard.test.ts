import { deepStrictEqual, notStrictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import type { DashboardField } from '../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import '../_fake-dom.ts';

const { stripIdentities } = await import('../../../src/dashboard/fields/clipboard.ts');
const { dashboardMeta } = await import('../../../src/dashboard/runtime/meta.ts');
const { sessionUser } = await import('../../../src/dashboard/runtime/session.ts');

const column = (name: string, type: string): DashboardField => ({
  name,
  type,
  kind: 'column',
  label: name,
  nullable: false,
  required: false,
  unique: false,
  translatable: false,
  readable: true,
  writable: true,
  immutable: false,
});

const PAYLOAD = column('payload', 'json');
const ROSTER: DashboardField = {
  ...column('roster', 'repeater'),
  kind: 'childMany',
  subfields: [column('name', 'text'), PAYLOAD],
};
const SECTIONS: DashboardField = { ...column('sections', 'blocks'), kind: 'blocks' };
const BANNER: DashboardField = {
  ...column('banner', 'object'),
  kind: 'childOne',
  subfields: [PAYLOAD],
};

/**
 * Lets the discovery fetches land and runs the effects they queued.
 */
async function fetched(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('stripIdentities', () => {
  before(async () => {
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (!url.endsWith('/dashboard'))
        return new Response(JSON.stringify({ UUID: 'u', roles: ['admin'] }));
      const blocks = [{ name: 'Hero', label: 'Hero', fields: [PAYLOAD] }];
      return new Response(JSON.stringify({ collections: [], locales: [], menu: [], blocks }));
    });
    sessionUser();
    await fetched();
    dashboardMeta();
    await fetched();
  });

  it('sheds the identity of every item, nested items included', () => {
    deepStrictEqual(
      stripIdentities(
        {
          UUID: 'item',
          roster: [
            { UUID: 'kept', name: 'Thrall' },
            { $key: 7, name: 'Jaina' },
          ],
          banner: { UUID: 'banner', payload: 1 },
        },
        [ROSTER, BANNER],
      ),
      { roster: [{ name: 'Thrall' }, { name: 'Jaina' }], banner: { payload: 1 } },
    );
  });

  it("keeps the keys of a field's own data", () => {
    const payload = { UUID: 'ext-1', $key: 'k', list: [{ UUID: 'x', n: 1 }] };
    deepStrictEqual(
      stripIdentities({ payload, roster: [{ UUID: 'r', payload }] }, [PAYLOAD, ROSTER]),
      {
        payload,
        roster: [{ payload }],
      },
    );
  });

  it("keeps the keys of a nested block's data while it sheds the block's identity", () => {
    const payload = { UUID: 'ext-1', $key: 'k' };
    deepStrictEqual(
      stripIdentities({ sections: [{ block: 'Hero', UUID: 'b', $key: 2, fields: { payload } }] }, [
        SECTIONS,
      ]),
      { sections: [{ block: 'Hero', fields: { payload } }] },
    );
  });

  it('sheds identities at every depth below a key no field declares', () => {
    deepStrictEqual(stripIdentities({ stray: [{ UUID: 'x', inner: { $key: 1, n: 2 } }] }, []), {
      stray: [{ inner: { n: 2 } }],
    });
  });

  it('returns a copy that shares nothing with the draft', () => {
    const payload = { tags: ['a'] };
    notStrictEqual(stripIdentities({ payload }, [PAYLOAD]).payload, payload);
  });
});
