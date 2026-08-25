import './foundation/01-variables.ts';
import './foundation/02-fonts.ts';
import './foundation/03-base.ts';
import './foundation/04-utils.ts';
import './foundation/05-prose.ts';
import './foundation/06-tooltip.ts';

/**
 * The dashboard's design foundation, adopted once on import.
 *
 * The system is a 1-to-1 port of Pruvious v4's `@pruvious/ui` foundation.
 * Tokens, fonts, base reset, utility classes, prose flow, and the tooltip theme adopt in that order.
 * The order is semantic: the zero-specificity base expects component css to load later.
 * `ohne-muted` relies on prose re-declaring it.
 * Every ui component imports this module, so using any of them adopts the foundation.
 */
