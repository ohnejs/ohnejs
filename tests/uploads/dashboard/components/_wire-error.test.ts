import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { readWireError } from '../../../../src/uploads/dashboard/components/_wire-error.ts';

const json = (body: unknown, status = 422): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('readWireError', () => {
  it('reads the field errors of a 422 and leads with the first', async () => {
    const error = await readWireError(
      json({
        statusCode: 422,
        message: 'Validation failed',
        data: { errors: { name: 'Name is taken', focalX: 'Out of range' } },
      }),
    );
    deepStrictEqual(error.errors, { name: 'Name is taken', focalX: 'Out of range' });
    strictEqual(error.message, 'Name is taken');
  });

  it('falls back to the wire message without field errors', async () => {
    const error = await readWireError(json({ statusCode: 404, message: 'Not found' }, 404));
    deepStrictEqual(error.errors, {});
    strictEqual(error.message, 'Not found');
  });

  it('answers the status text for a body that is not JSON', async () => {
    const response = new Response('<html>', { status: 502, statusText: 'Bad Gateway' });
    const error = await readWireError(response);
    deepStrictEqual(error.errors, {});
    strictEqual(error.message, 'Bad Gateway');
  });
});
