import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useAcceptsLanguages } from '../../../src/ohne/index.ts';

function makeEvent(acceptLanguage?: string): Event {
  const headers = new Headers();
  if (acceptLanguage !== undefined) headers.set('accept-language', acceptLanguage);
  return {
    request: new Request('http://localhost/', { headers }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useAcceptsLanguages', () => {
  it('picks the best language the client accepts', () => {
    runWithEvent(makeEvent('de-AT, de;q=0.9, en;q=0.5'), () => {
      strictEqual(useAcceptsLanguages(['en', 'de']), 'de');
    });
  });

  it('returns undefined when the client accepts none of the offers', () => {
    runWithEvent(makeEvent('fr-FR'), () => {
      strictEqual(useAcceptsLanguages(['en', 'de']), undefined);
    });
  });

  it('returns the first offer when no Accept-Language header is sent', () => {
    runWithEvent(makeEvent(), () => {
      strictEqual(useAcceptsLanguages(['en', 'de']), 'en');
    });
  });

  it('appends Accept-Language to the response Vary header', () => {
    const event = makeEvent('en');
    event.response.headers.set('vary', 'Accept');
    runWithEvent(event, () => useAcceptsLanguages(['en']));
    strictEqual(event.response.headers.get('vary'), 'Accept, Accept-Language');
  });
});
