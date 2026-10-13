import { isHTTPURL } from '../../../utils/is/is-http-url.ts';
import { normalizeHTTPURL } from '../../../utils/uri/normalize-http-url.ts';
import { typedHref } from '../../../utils/uri/typed-href.ts';
import { checkURL } from '../../../utils/validate/check-url.ts';
import { useT } from '../../runtime/use-t.ts';
import { registerFieldType } from '../field-type.ts';
import { addressType } from './_address.ts';

/**
 * The `url` field type: a web address the control folds as the server stores it.
 * A bare host such as `dalaran.example` reads as `https://dalaran.example`, as `link` reads it.
 * The control's button opens a valid address in a new tab.
 */
export const urlType = addressType({
  inputMode: 'url',
  canonical: normalizeHTTPURL,
  check: checkURL,
  href: (value) => (isHTTPURL(value) ? value : undefined),
  typed: (text) => typedHref(text) ?? text,
  icon: 'external-link',
  action: () => useT()('dashboard.open'),
});

registerFieldType('url', urlType);
