import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineHandler } from '../../../src/ohne/index.ts';

describe('defineHandler', () => {
  it('returns the handler unchanged', () => {
    const handler = defineHandler(({ params }) => ({ id: params.id }));
    deepStrictEqual(handler({ params: { id: '42' } }), { id: '42' });
  });

  it('infers the result type from the return rather than falling back to unknown', () => {
    const handler = defineHandler(({ params }) => ({ id: params.id }));
    const result: { id: string } | Promise<{ id: string }> = handler({ params: { id: '7' } });
    deepStrictEqual(result, { id: '7' });
  });

  it('exposes the awaited return type, as a future fetcher recovers it from codegen', async () => {
    const handler = defineHandler(async () => ({ title: 'x' }));
    type Response = Awaited<ReturnType<typeof handler>>;
    const ok: Response = { title: 'x' };
    // @ts-expect-error the response is `{ title: string }`, not a string
    const bad: Response = 'no';
    deepStrictEqual(await handler({ params: {} }), ok);
    void bad;
  });

  it('preserves the identity of the function', () => {
    const fn = ({ params }: { params: Record<string, string> }) => params;
    strictEqual(defineHandler(fn), fn);
  });
});
