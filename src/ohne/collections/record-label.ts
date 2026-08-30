import type { RecordLabel } from './define-collection.ts';

import { isString } from '../../utils/index.ts';

/**
 * Whether a `recordLabel` declaration is the template form.
 * A brace anywhere marks a template; a field name never carries one, so a stray brace routes here too.
 */
export function isRecordLabelTemplate(recordLabel: RecordLabel): recordLabel is string {
  return isString(recordLabel) && /[{}]/.test(recordLabel);
}
