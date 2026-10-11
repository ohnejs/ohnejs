import { css } from '../../render/css.ts';

/**
 * The design tokens.
 * Every color token is a raw HSL triplet, composed at use sites as `hsl(var(--ohne-x))`.
 * An alpha composes as `hsl(var(--ohne-x) / 0.25)`.
 * The chart slots run in a fixed order, checked as a set for color-vision deficiency.
 * Light values live on `:root`; `.dark` on `<html>` overrides colors only.
 *
 * `--ohne-size` and `--ohne-spacing` are unitless knobs.
 * `--ohne-gap` is the layout spacing unit `--ohne-spacing` scales.
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
    --ohne-success: 142 72% 29%;
    --ohne-success-foreground: 0 0% 98%;
    --ohne-warning: 32 95% 34%;
    --ohne-warning-foreground: 0 0% 98%;
    --ohne-info: 213 80% 45%;
    --ohne-info-foreground: 0 0% 98%;

    --ohne-chart-1: 212.8 67.7% 50.2%;
    --ohne-chart-2: 17 82.1% 56.3%;
    --ohne-chart-3: 158.5 73.3% 39.6%;
    --ohne-chart-4: 40.8 100% 46.5%;
    --ohne-chart-5: 337.4 70.3% 69.6%;
    --ohne-chart-6: 120 100% 25.7%;
    --ohne-chart-7: 248.1 62% 57.6%;
    --ohne-chart-8: 0.4 73.5% 58.6%;

    --ohne-radius: 0.5rem;
    --ohne-font: 'Inter', sans-serif;
    --ohne-font-mono: 'Fira Mono', monospace;
    --ohne-headings: var(--ohne-font);
    --ohne-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    --ohne-transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --ohne-overlay-transition-duration: 300ms;

    --ohne-size: 0;
    --ohne-spacing: 0;
    --ohne-gap: calc(0.75rem + var(--ohne-spacing) * 0.125rem);
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
    --ohne-success: 142 60% 52%;
    --ohne-success-foreground: 240 5.9% 10%;
    --ohne-warning: 38 92% 58%;
    --ohne-warning-foreground: 240 5.9% 10%;
    --ohne-info: 213 90% 66%;
    --ohne-info-foreground: 240 5.9% 10%;

    --ohne-chart-1: 212.8 76.8% 56.1%;
    --ohne-chart-2: 17.1 70.2% 50%;
    --ohne-chart-3: 159.2 72.7% 35.9%;
    --ohne-chart-4: 39.7 100% 39.4%;
    --ohne-chart-5: 338.2 61.1% 57.6%;
    --ohne-chart-6: 120 100% 25.7%;
    --ohne-chart-7: 246.6 69.4% 71.8%;
    --ohne-chart-8: 0 71.8% 65.3%;
  }
`;
