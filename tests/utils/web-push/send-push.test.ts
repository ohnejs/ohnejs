import { ok, strictEqual } from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';

import { generateVAPIDKeys, sendPush } from '../../../src/utils/index.ts';

const subscription = {
  endpoint: 'https://push.example.net/push/abc',
  keys: {
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

const vapid = { ...(await generateVAPIDKeys()), subject: 'mailto:ops@example.net' };

describe('sendPush', () => {
  let sent: Request | undefined;
  before(() => {
    mock.method(globalThis, 'fetch', async (input: Request) => {
      sent = input;
      return new Response(null, { status: 201 });
    });
  });
  after(() => mock.restoreAll());

  it('posts the request and returns the push service response', async () => {
    const response = await sendPush(subscription, 'hi', vapid, { urgency: 'low' });
    strictEqual(response.status, 201);
    strictEqual(sent?.method, 'POST');
    strictEqual(sent?.headers.get('Urgency'), 'low');
    strictEqual((await sent?.bytes())?.length, 86 + 2 + 17);
  });

  it('bounds the request with a deadline unless given a signal', async () => {
    await sendPush(subscription, 'hi', vapid);
    ok(sent?.signal);
    strictEqual(sent.signal.aborted, false);

    const controller = new AbortController();
    controller.abort();
    await sendPush(subscription, 'hi', vapid, { signal: controller.signal });
    strictEqual(sent?.signal.aborted, true);
  });
});
