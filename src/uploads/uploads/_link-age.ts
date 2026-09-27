import { parseDuration } from 'ohnejs/utils';

/**
 * The longest any private link may last, in milliseconds.
 * The dashboard's longest choice.
 */
export const LINK_MAX_AGE = parseDuration('30d');
