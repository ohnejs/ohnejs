import { isNull } from '../../../utils/is/is-null.ts';
import { defaultText, resolveText, type Text } from '../../runtime/text.ts';

/**
 * One line or one set of bars in a chart: a name and the value it reads off each row.
 */
export interface Series<T> {
  /**
   * What the series counts, shown in the legend, the tooltip and the screen reader table.
   */
  name: Text;

  /**
   * The series' value at a row; `null` is a gap, never a zero.
   */
  value: (row: T) => number | null;

  /**
   * Draws the line dashed, as a previous period or a target reads.
   * Bars ignore it.
   *
   * @default
   * false
   */
  dashed?: boolean;
}

/**
 * A series resolved against the rows, ready to draw.
 * Its `slot` picks `--ohne-chart-<slot>`; `null` is the folded "Other", drawn in the muted ink.
 */
export interface PlottedSeries {
  /**
   * The series name in the active language, read reactively.
   */
  name: () => string;

  /**
   * The value at each row, `null` where the series has a gap.
   */
  values: (number | null)[];

  /**
   * Whether the line draws dashed.
   */
  dashed: boolean;

  /**
   * The palette slot from `1`, or `null` for "Other".
   */
  slot: number | null;
}

/**
 * How many categorical colors the palette holds, in a fixed, validated order.
 */
export const SLOTS = 8;

/**
 * The `style` that sets `--ohne-chart-ink` to a slot's color, or to the muted ink for "Other".
 */
export function inkStyle(slot: number | null): string {
  return `--ohne-chart-ink: var(${isNull(slot) ? '--ohne-muted-foreground' : `--ohne-chart-${slot}`})`;
}

/**
 * The name of the folded series or slice.
 */
export function otherName(): string {
  return defaultText('dashboard.other', 'Other');
}

/**
 * Resolves `series` against `rows`, each in the slot of its index, so a color follows its series.
 * Past `SLOTS` series, the series from the last slot on fold into one "Other" that sums them.
 */
export function plotSeries<T>(rows: readonly T[], series: readonly Series<T>[]): PlottedSeries[] {
  const plotted = series.map((one, index): PlottedSeries => ({
    name: () => resolveText(one.name),
    values: rows.map((row) => one.value(row)),
    dashed: one.dashed === true,
    slot: index + 1,
  }));
  if (plotted.length <= SLOTS) return plotted;
  const kept = plotted.slice(0, SLOTS - 1);
  const folded = plotted.slice(SLOTS - 1);
  const values = rows.map((_, index) =>
    folded.reduce<number | null>((sum, one) => {
      const value = one.values[index] ?? null;
      return isNull(value) ? sum : (sum ?? 0) + value;
    }, null),
  );
  return [...kept, { name: otherName, values, dashed: false, slot: null }];
}
