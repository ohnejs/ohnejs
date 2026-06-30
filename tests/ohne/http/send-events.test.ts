import { deepStrictEqual, strictEqual } from 'node:assert';
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
});
