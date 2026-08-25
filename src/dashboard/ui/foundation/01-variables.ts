import { css } from '../../render/css.ts';

/**
 * The design tokens, ported 1-to-1 from Pruvious v4.
 * Every color token is a raw HSL triplet, composed at use sites as `hsl(var(--ohne-x))`.
 * An alpha composes as `hsl(var(--ohne-x) / 0.25)`.
 * Light values live on `:root`; `.dark` on `<html>` overrides colors only.
 *
 * `--ohne-size` and `--ohne-spacing` are unitless knobs.
 * A component root derives its font size as `calc(1rem + var(--ohne-size) * 0.125rem)`.
 * Everything inside is sized in `em`, so the whole component scales from that one declaration.
 * Overlays re-enter the system through their own root knobs (`--ohne-dialog-size`, ...).
 */
css`
  :root {
    --ohne-background: 210 22.2% 96.5%;
    --ohne-foreground: 324 49% 10%;
    --ohne-card: 0 0% 100%;
    --ohne-card-foreground: 324 49% 10%;
    --ohne-popover: 0 0% 100%;
    --ohne-popover-foreground: 324 49% 10%;
    --ohne-primary: 324 49% 10%;
    --ohne-primary-foreground: 0 0% 98%;
    --ohne-secondary: 240 4.8% 94%;
    --ohne-secondary-foreground: 324 49% 10%;
    --ohne-muted: 240 4.8% 94%;
    --ohne-muted-foreground: 228 11% 44%;
    --ohne-accent: 209 71% 88%;
    --ohne-accent-foreground: 324 49% 10%;
    --ohne-destructive: 0 84.2% 60.2%;
    --ohne-destructive-foreground: 0 0% 98%;
    --ohne-border: 210 8% 90.2%;
    --ohne-input: 210 7.41% 89.4%;
    --ohne-ring: 324 49% 10%;

    --ohne-radius: 0.5rem;
    --ohne-font: 'Inter', sans-serif;
    --ohne-font-mono: 'Fira Mono', monospace;
    --ohne-headings: var(--ohne-font);
    --ohne-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    --ohne-transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --ohne-overlay-transition-duration: 300ms;

    --ohne-size: 0;
    --ohne-spacing: 0;
    --ohne-dialog-size: 0;
    --ohne-toast-size: 0;
    --ohne-tooltip-size: 0;
  }

  .dark {
    --ohne-background: 234 16.7% 11.8%;
    --ohne-foreground: 0 0% 98%;
    --ohne-card: 231 16.7% 16.5%;
    --ohne-card-foreground: 0 0% 98%;
    --ohne-popover: 231 16.7% 16.5%;
    --ohne-popover-foreground: 0 0% 98%;
    --ohne-primary: 0 0% 98%;
    --ohne-primary-foreground: 240 5.9% 10%;
    --ohne-secondary: 231 16.7% 24%;
    --ohne-secondary-foreground: 0 0% 98%;
    --ohne-muted: 231 16.7% 24%;
    --ohne-muted-foreground: 228 11% 65%;
    --ohne-accent: 208 52% 28%;
    --ohne-accent-foreground: 0 0% 98%;
    --ohne-destructive: 7.41 84.2% 60.4%;
    --ohne-destructive-foreground: 0 0% 98%;
    --ohne-border: 231 16.7% 24%;
    --ohne-input: 231 16.7% 32%;
    --ohne-ring: 240 4.9% 83.9%;
  }
`;
