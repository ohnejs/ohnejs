import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  AccessContext,
  CollectionEndpoint,
} from '../../../src/ohne/collections/define-collection.ts';

import { endpointOf, resolveAccess } from '../../../src/ohne/collections/access.ts';

describe('endpointOf', () => {
  it('opens every operation guarded under true, none under false or an omitted api', () => {
    deepStrictEqual(endpointOf(true, 'read'), {});
    strictEqual(endpointOf(false, 'read'), undefined);
    strictEqual(endpointOf(undefined, 'delete'), undefined);
  });

  it('reads one shape from every slot spelling', () => {
    const api = { read: 'public' as const, create: true, update: { middleware: ['audit'] } };
    deepStrictEqual(endpointOf(api, 'read'), { public: true });
    deepStrictEqual(endpointOf(api, 'create'), {});
    strictEqual(endpointOf(api, 'update'), api.update);
    strictEqual(endpointOf(api, 'delete'), undefined);
  });

  it('closes an operation named false', () => {
    strictEqual(endpointOf({ read: false }, 'read'), undefined);
  });
});

describe('resolveAccess', () => {
  const read: AccessContext<'read'> = { operation: 'read' };

  it('is the empty scope under an omitted resolver or true', async () => {
    deepStrictEqual(await resolveAccess({}, read), {});
    deepStrictEqual(await resolveAccess({ access: () => true }, read), {});
  });

  it('is false under a refusal', async () => {
    strictEqual(await resolveAccess({ access: async () => false }, read), false);
  });

  it('returns the resolved scope as is', async () => {
    const scope = { where: { owner: 'u1' }, select: ['title'] };
    strictEqual(await resolveAccess({ access: () => scope }, read), scope);
  });

  it('hands the resolver its context', async () => {
    const seen: AccessContext[] = [];
    const endpoint: CollectionEndpoint<string, 'update'> = {
      access: (context) => (seen.push(context), true),
    };
    await resolveAccess(endpoint, { operation: 'update', input: { title: 'x' } });
    deepStrictEqual(seen, [{ operation: 'update', input: { title: 'x' } }]);
  });

  it('throws on an empty select instead of widening', async () => {
    await rejects(resolveAccess({ access: () => ({ select: [] }) }, read), /empty `select`/);
  });
});
