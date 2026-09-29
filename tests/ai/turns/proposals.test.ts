import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Proposal } from '../../../src/ai/turns/proposals.ts';
import type { Receipt } from '../../../src/ai/turns/receipts.ts';

import { checkProposal } from '../../../src/ai/turns/proposals.ts';
import { renderSurface } from '../../../src/ai/turns/surface.ts';
import { requireUser } from '../../../src/base/auth/require-user.ts';
import { readJSONBody } from '../../../src/ohne/http/read-json-body.ts';
import { call, route, signIn, withAI } from '../_fixture.ts';

type Outcome =
  | { ok: true; proposal: Proposal; identity: boolean }
  | { ok: false; receipt: Receipt };

/**
 * Checks the body's proposal against the person's surface, for a model that sees values or not.
 */
async function checked(values: boolean): Promise<Outcome> {
  const surface = await renderSurface(await requireUser(), values);
  const result = await checkProposal(await readJSONBody(), surface);
  return result.ok
    ? { ok: true, proposal: result.accepted.proposal, identity: result.accepted.identity }
    : { ok: false, receipt: result.receipt };
}

const CHECK = route('POST', '/check', () => checked(true));
const BLIND_CHECK = route('POST', '/check', () => checked(false));

const officer = await signIn('officer@proposals.example.com', ['officer']);
const admin = await signIn('admin@proposals.example.com', ['admin']);

const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';
const QUERY = 'POST /collections/characters/query';
const VERDICTS = 'POST /collections/characters/verdicts';
const GET = 'GET /collections/characters/[uuid]';
const PATCH = 'PATCH /collections/characters/[uuid]';
const PATCH_ITEM = 'PATCH /collections/items/[uuid]';
const COPY = 'POST /collections/items/[uuid]/translations/copy';
const CREATE_ITEM = 'POST /collections/items';

/**
 * Checks `proposal` as the officer, or as the person `token` signs in, under the default settings.
 */
async function check(proposal: unknown, token = officer.token): Promise<Outcome> {
  let outcome: Outcome | undefined;
  await withAI(undefined, async () => {
    const { response } = await call(CHECK, {
      path: '/check',
      body: proposal,
      token,
    });
    strictEqual(response.status, 200);
    outcome = (await response.json()) as Outcome;
  });
  return outcome as Outcome;
}

/**
 * Whether an accepted proposal passed the identity rule; `undefined` for a refusal.
 */
function identityOf(outcome: Outcome): boolean | undefined {
  return outcome.ok ? outcome.identity : undefined;
}

/**
 * The refusal of `route` with `code` at `path`.
 */
function refused(route: string, code: string, path?: string): Outcome {
  return {
    ok: false,
    receipt: { route, status: 400, code, ...(path === undefined ? {} : { path }) },
  };
}

describe('checkProposal', () => {
  it('refuses a route the surface does not offer, whatever the reason', async () => {
    deepStrictEqual(
      await check({ route: 'GET /reports' }),
      refused('GET /reports', 'unknownRoute', 'route'),
    );
    deepStrictEqual(
      await check({ route: 'POST /auth/login', body: {} }),
      refused('POST /auth/login', 'unknownRoute', 'route'),
    );
    deepStrictEqual(
      await check({ route: 'POST /collections/users/query', body: {} }),
      refused('POST /collections/users/query', 'unknownRoute', 'route'),
    );
    deepStrictEqual(
      await check({ route: 'DELETE /collections/items/[uuid]', params: { uuid: UUID } }),
      refused('DELETE /collections/items/[uuid]', 'unknownRoute', 'route'),
    );
    deepStrictEqual(await check('GET /x'), refused('', 'invalidShape'));
    deepStrictEqual(
      await check({ route: QUERY, extra: 1 }),
      refused(QUERY, 'unknownParam', 'extra'),
    );
  });

  it('checks the params: every one named, a `uuid` a UUID, nothing extra', async () => {
    deepStrictEqual(await check({ route: GET }), refused(GET, 'invalidValue', 'params.uuid'));
    deepStrictEqual(
      await check({ route: GET, params: { uuid: 'x?locale=de' } }),
      refused(GET, 'invalidValue', 'params.uuid'),
    );
    deepStrictEqual(
      await check({ route: GET, params: { uuid: UUID, id: '1' } }),
      refused(GET, 'unknownParam', 'params.id'),
    );
    deepStrictEqual(await check({ route: GET, params: { uuid: UUID } }), {
      ok: true,
      proposal: { route: GET, tier: 'read', params: { uuid: UUID } },
      identity: false,
    });
  });

  it('checks the query: only the keys the route takes, each as its read would parse it', async () => {
    deepStrictEqual(
      await check({ route: PATCH, params: { uuid: UUID }, query: { select: ['name'] }, body: {} }),
      refused(PATCH, 'unknownParam', 'query.select'),
    );
    deepStrictEqual(
      await check({ route: GET, params: { uuid: UUID }, query: { select: ['nope'] } }),
      refused(GET, 'invalidField', 'query.select[0]'),
    );
    deepStrictEqual(
      await check({ route: GET, params: { uuid: UUID }, query: { populate: ['owner'] } }),
      refused(GET, 'invalidField', 'query.populate[0]'),
    );
    deepStrictEqual(
      await check({ route: PATCH_ITEM, params: { uuid: UUID }, query: { locale: 'fr' }, body: {} }),
      refused(PATCH_ITEM, 'invalidLocale', 'query.locale'),
    );
    deepStrictEqual(
      await check({ route: PATCH, params: { uuid: UUID }, query: { locale: 'de' }, body: {} }),
      refused(PATCH, 'localeNotApplicable', 'query.locale'),
    );
    const outcome = await check({
      route: GET,
      params: { uuid: UUID },
      query: { select: ['name'], populate: ['guild'] },
    });
    strictEqual(outcome.ok, true);
  });

  it('parses a list read as the person would, denied collections out of reach', async () => {
    const owner = { where: { owner: { has: { email: { startsWith: 'a' } } } } };
    deepStrictEqual(
      await check({ route: QUERY, body: owner }),
      refused(QUERY, 'invalidField', 'body.where.owner.email'),
    );
    deepStrictEqual(
      await check({ route: QUERY, body: owner }, admin.token),
      refused(QUERY, 'invalidField', 'body.where.owner.email'),
    );
    deepStrictEqual(
      await check({ route: VERDICTS, body: owner }, admin.token),
      refused(VERDICTS, 'invalidField', 'body.where.owner.email'),
    );
    deepStrictEqual(
      await check({ route: PATCH, where: owner.where, body: { status: 'retired' } }, admin.token),
      refused(PATCH, 'invalidField', 'where.owner.email'),
    );
    deepStrictEqual(
      await check({ route: QUERY, body: { populate: ['owner'] } }),
      refused(QUERY, 'invalidField', 'body.populate[0]'),
    );
    deepStrictEqual(
      await check({ route: QUERY, body: { populate: [{ guild: { populate: ['nope'] } }] } }),
      refused(QUERY, 'invalidField', 'body.populate[0].guild.populate[0]'),
    );
    deepStrictEqual(
      await check({ route: QUERY, body: { where: { level: { above: 3 } } } }),
      refused(QUERY, 'unknownOperator', 'body.where.level.above'),
    );
    deepStrictEqual(
      await check({ route: QUERY, body: { where: { UUID: UUID }, populate: ['guild'] } }),
      {
        ok: true,
        proposal: {
          route: QUERY,
          tier: 'read',
          body: { where: { UUID: UUID }, populate: ['guild'], page: 1 },
        },
        identity: true,
      },
    );
    const listed = await check({ route: QUERY, body: { where: { level: 60 }, perPage: 5 } });
    deepStrictEqual(listed, {
      ok: true,
      proposal: { route: QUERY, tier: 'read', body: { where: { level: 60 }, perPage: 5 } },
      identity: false,
    });
    const selected = await check({ route: QUERY, body: { select: ['name'], page: 1 } });
    deepStrictEqual(selected.ok && selected.proposal.body?.select, ['UUID', 'name']);
  });

  it('passes an opened field under the identity rule only for a model that sees values', async () => {
    const proposal = { route: QUERY, body: { where: { level: 60 } } };
    for (const [checker, identity] of [
      [CHECK, true],
      [BLIND_CHECK, false],
    ] as const) {
      await withAI({ data: { Characters: ['level'] } }, async () => {
        const { response } = await call(checker, {
          path: '/check',
          body: proposal,
          token: officer.token,
        });
        strictEqual(identityOf((await response.json()) as Outcome), identity);
      });
    }
  });

  it('checks a verdicts body: named rows each a UUID, or a filter parsed as the list read', async () => {
    deepStrictEqual(
      await check({ route: VERDICTS, body: { UUIDs: ['nope'] } }),
      refused(VERDICTS, 'invalidValue', 'body.UUIDs'),
    );
    deepStrictEqual(
      await check({ route: VERDICTS, body: { UUIDs: [UUID], where: { level: 1 } } }),
      refused(VERDICTS, 'invalidValue', 'body.where'),
    );
    deepStrictEqual(
      await check({ route: VERDICTS, body: { select: ['name'] } }),
      refused(VERDICTS, 'unknownParam', 'body.select'),
    );
    deepStrictEqual(
      await check({ route: VERDICTS, body: { where: { owner: { has: { email: 'a' } } } } }),
      refused(VERDICTS, 'invalidField', 'body.where.owner.email'),
    );
    strictEqual(identityOf(await check({ route: VERDICTS, body: { UUIDs: [UUID] } })), true);
    strictEqual(identityOf(await check({ route: VERDICTS, body: { where: { level: 1 } } })), false);
    strictEqual(
      identityOf(await check({ route: VERDICTS, body: { where: { UUID: UUID } } })),
      true,
    );
  });

  it('lets a locale-tagged update carry translatable fields alone, and a create any', async () => {
    const at = { params: { uuid: UUID }, query: { locale: 'de' } };
    deepStrictEqual(
      await check({ route: PATCH_ITEM, ...at, body: { name: 'Aschenbringer', rarity: 'epic' } }),
      refused(PATCH_ITEM, 'invalidField', 'body.rarity'),
    );
    deepStrictEqual(
      await check({ route: PATCH_ITEM, ...at, body: { nope: 1 } }),
      refused(PATCH_ITEM, 'invalidField', 'body.nope'),
    );
    strictEqual(
      (await check({ route: PATCH_ITEM, ...at, body: { name: 'Aschenbringer' } })).ok,
      true,
    );
    strictEqual(
      (await check({ route: PATCH_ITEM, params: { uuid: UUID }, body: { rarity: 'epic' } })).ok,
      true,
    );
    deepStrictEqual(
      await check({ route: PATCH, params: { uuid: UUID } }),
      refused(PATCH, 'invalidShape', 'body'),
    );
    const created = { query: { locale: 'de' }, body: { name: 'Aschenbringer', rarity: 'epic' } };
    strictEqual((await check({ route: CREATE_ITEM, ...created }, admin.token)).ok, true);
  });

  it('checks a write by set: a `uuid` route above the read tier, its filter parsed as the list read', async () => {
    const retire = { where: { level: { lessThan: 10 } }, body: { status: 'retired' } };
    deepStrictEqual(await check({ route: PATCH, ...retire }), {
      ok: true,
      proposal: { route: PATCH, tier: 'write', ...retire },
      identity: false,
    });
    deepStrictEqual(
      await check({ route: PATCH, params: { uuid: UUID }, ...retire }),
      refused(PATCH, 'invalidShape', 'params'),
    );
    deepStrictEqual(
      await check({ route: GET, where: { level: 1 } }),
      refused(GET, 'invalidShape', 'where'),
    );
    deepStrictEqual(
      await check({ route: QUERY, where: { level: 1 }, body: {} }),
      refused(QUERY, 'invalidShape', 'where'),
    );
    deepStrictEqual(
      await check({ route: PATCH, where: { owner: { has: { email: 'a' } } }, body: {} }),
      refused(PATCH, 'invalidField', 'where.owner.email'),
    );
  });

  it('takes a body only where the route does, and a copy only its `source`', async () => {
    const del = 'DELETE /collections/characters/[uuid]';
    deepStrictEqual(
      await check({ route: del, params: { uuid: UUID }, body: {} }),
      refused(del, 'unknownParam', 'body'),
    );
    deepStrictEqual(
      await check({ route: COPY, params: { uuid: UUID }, body: { locale: 'de' } }),
      refused(COPY, 'unknownParam', 'body.locale'),
    );
    deepStrictEqual(
      await check({ route: COPY, params: { uuid: UUID }, body: { source: 'fr' } }),
      refused(COPY, 'invalidLocale', 'body.source'),
    );
    strictEqual(
      (
        await check({
          route: COPY,
          params: { uuid: UUID },
          query: { locale: 'de' },
          body: { source: 'en' },
        })
      ).ok,
      true,
    );
    strictEqual((await check({ route: del, params: { uuid: UUID } })).ok, true);
  });
});
