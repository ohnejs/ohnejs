import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useEvent } from '../../../src/ohne/index.ts';

function makeEvent(url = 'http://localhost/'): Event {
  return {
    request: new Request(url),
    url: new URL(url),
    params: {},
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useEvent', () => {
  it('returns the event bound by runWithEvent', () => {
    const event = makeEvent();
    runWithEvent(event, () => {
      strictEqual(useEvent(), event);
    });
  });

  it('reaches the event across async depth', async () => {
    const event = makeEvent();
    await runWithEvent(event, async () => {
      await Promise.resolve();
      const deep = async () => useEvent();
      strictEqual(await deep(), event);
    });
  });

  it('binds the innermost event under nesting', () => {
    const outer = makeEvent('http://localhost/outer');
    const inner = makeEvent('http://localhost/inner');
    runWithEvent(outer, () => {
      runWithEvent(inner, () => strictEqual(useEvent(), inner));
      strictEqual(useEvent(), outer);
    });
  });

  it('throws when called outside a request', () => {
    throws(() => useEvent(), /outside of a request/);
  });

  it('returns the function result from runWithEvent', () => {
    strictEqual(
      runWithEvent(makeEvent(), () => 42),
      42,
    );
  });
});
