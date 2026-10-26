/**
 * The meaning a component's color carries.
 * Each tone maps to its `--ohne-<tone>` token and that token's foreground, in light and dark.
 * `neutral` is the muted surface; the status tones always ship with an icon or a label, never color alone.
 */
export type Tone =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral';

/**
 * The tones that report a status, painted with their own color rather than as a surface.
 */
export const STATUS_TONES: ReadonlySet<Tone> = new Set([
  'destructive',
  'success',
  'warning',
  'info',
]);
