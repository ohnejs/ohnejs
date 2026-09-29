import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, sendEvents, useEvent } from '../../../src/ohne/index.ts';

function makeEvent(): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

async function read(body: ReadableStream<Uint8Array>): Promise<string> {
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of body) text += decoder.decode(chunk, { stream: true });
  return text;
}

describe('sendEvents', () => {
  it('sets the event-stream content type and disables caching', () => {
    runWithEvent(makeEvent(), () => {
      sendEvents();
      strictEqual(useEvent().response.headers.get('content-type'), 'text/event-stream');
      strictEqual(useEvent().response.headers.get('cache-control'), 'no-cache');
    });
  });

  it('opens the stream with a comment so the response headers flush on connect', async () => {
    const stream = runWithEvent(makeEvent(), () => sendEvents());
    stream.close();
    strictEqual(await read(stream.body), ': open\n\n');
  });

  it('streams each sent message as an SSE frame, then closes', async () => {
    const stream = runWithEvent(makeEvent(), () => sendEvents());
    stream.send('reload');
    stream.send('hi', { event: 'greet' });
    stream.close();
    strictEqual(await read(stream.body), ': open\n\ndata: reload\n\nevent: greet\ndata: hi\n\n');
  });

  it('pings on the heartbeat interval until the stream closes', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const stream = runWithEvent(makeEvent(), () => sendEvents({ heartbeat: '15s' }));
    t.mock.timers.tick(15_000);
    stream.send('reload');
    t.mock.timers.tick(15_000);
    stream.close();
    t.mock.timers.tick(15_000);
    strictEqual(await read(stream.body), ': open\n\n: ping\n\ndata: reload\n\n: ping\n\n');
  });

  it('sends no ping without a heartbeat', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const stream = runWithEvent(makeEvent(), () => sendEvents());
    t.mock.timers.tick(60_000);
    stream.close();
    strictEqual(await read(stream.body), ': open\n\n');
  });

  it('throws on a line break in the id and keeps the stream open', async () => {
    const stream = runWithEvent(makeEvent(), () => sendEvents());
    throws(() => stream.send('x', { id: '7\n\nevent: logout' }), /line break/);
    stream.send('ok');
    stream.close();
    strictEqual(await read(stream.body), ': open\n\ndata: ok\n\n');
  });

  it('ignores sends after close and runs onClose once', () => {
    const closed: number[] = [];
    const stream = runWithEvent(makeEvent(), () => sendEvents({ onClose: () => closed.push(1) }));
    stream.close();
    stream.close();
    stream.send('late');
    deepStrictEqual(closed, [1]);
  });

  it('runs onClose when the client disconnects', async () => {
    let closed = false;
    const stream = runWithEvent(makeEvent(), () =>
      sendEvents({ onClose: () => void (closed = true) }),
    );
    await stream.body.cancel();
    strictEqual(closed, true);
    stream.send('after-cancel');
  });

  it('disconnects a stalled client once the unread queue passes the frame bound', async () => {
    let closed = false;
    const stream = runWithEvent(makeEvent(), () =>
      sendEvents({ onClose: () => void (closed = true) }),
    );
    let sent = 0;
    while (!closed && sent < 2000) {
      stream.send(`m${sent}`);
      sent++;
    }
    strictEqual(closed, true);
    strictEqual(sent <= 1030, true);
    await rejects(read(stream.body), { name: 'AbortError' });
  });

  it('keeps a draining client connected across many more sends than the bound', async () => {
    let closed = false;
    const stream = runWithEvent(makeEvent(), () =>
      sendEvents({ onClose: () => void (closed = true) }),
    );
    const consumed = read(stream.body);
    for (let batch = 0; batch < 30; batch++) {
      for (let i = 0; i < 100; i++) stream.send('m');
      await new Promise((resolve) => setImmediate(resolve));
    }
    strictEqual(closed, false);
    stream.close();
    const text = await consumed;
    strictEqual(text.split('data: m\n\n').length - 1, 3000);
  });
});
