import { didYouMean, isString, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { iconNames, isIconName } from './icon-shapes.ts';

/**
 * Rejects an icon the vendored Tabler set does not carry.
 * The type already narrows this for a TypeScript caller, and the check catches a plain-JS one.
 * A row that would silently render no icon becomes a named failure at boot.
 * `option` names the declaring key, like `dashboard.icon`; `scope` places it, like `` in block `Hero` ``.
 */
export function validateIcon(icon: unknown, option: string, scope: string): void {
  if (isUndefined(icon)) return;
  if (!isString(icon)) {
    throw ohneError({
      title: `Invalid \`${option}\` declaration`,
      body: [`The \`${option}\` option${scope} must be an icon name.`],
    });
  }
  if (isIconName(icon)) return;
  const near = didYouMean(icon, iconNames());
  throw ohneError({
    title: `Unknown icon \`${icon}\``,
    body: [
      `The \`${option}\` option${scope} names an icon the set does not carry.`,
      isUndefined(near)
        ? 'Every icon is a Tabler original; browse the names at `https://tabler.io/icons`.'
        : `Did you mean \`${near}\`?`,
    ],
  });
}
