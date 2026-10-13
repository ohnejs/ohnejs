import { normalizeEmail } from '../../../utils/text/normalize-email.ts';
import { mailtoHref } from '../../../utils/uri/mailto-href.ts';
import { checkEmail } from '../../../utils/validate/check-email.ts';
import { useT } from '../../runtime/use-t.ts';
import { registerFieldType } from '../field-type.ts';
import { addressType } from './_address.ts';

/**
 * The `email` field type: an address the control lowercases as the server stores it.
 * The control's button writes an email to a valid address.
 */
export const emailType = addressType({
  inputMode: 'email',
  canonical: normalizeEmail,
  check: checkEmail,
  href: mailtoHref,
  icon: 'mail',
  action: () => useT()('dashboard.email.write'),
});

registerFieldType('email', emailType);
