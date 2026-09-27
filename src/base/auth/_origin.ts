import { forbidden, useEvent } from 'ohnejs';
import { isCrossOriginWrite, isNull } from 'ohnejs/utils';

import { translate } from '../../ohne/http/translate.ts';

/**
 * Refuses the session cookie on an unsafe request from a browser page the CORS policy has not credentialed.
 * The refusal is a `403` naming the request's origin.
 *
 * The credential grant is read from the headers the global cors already set, so trust is the policy that ran.
 */
export function assertCookieOrigin(): void {
  const { request, response, url } = useEvent();
  const origin = request.headers.get('origin');
  const granted =
    response.headers.get('access-control-allow-credentials') === 'true'
      ? response.headers.get('access-control-allow-origin')
      : null;
  const trusted = isNull(granted) || granted === '*' ? [] : [granted];
  const crossOrigin = isCrossOriginWrite(
    {
      method: request.method,
      origin,
      fetchSite: request.headers.get('sec-fetch-site'),
      self: url.origin,
    },
    trusted,
  );
  if (crossOrigin) throw forbidden(translate('auth.untrustedOrigin', { origin: origin ?? 'null' }));
}
