import type { NumberFormatOptions } from '../../runtime/number.ts';

import { byteExponent } from '../../../utils/bytes/byte-exponent.ts';
import { currencyDigits } from '../../../utils/i18n/currency-digits.ts';
import { isFunction } from '../../../utils/is/is-function.ts';
import { isUndefined } from '../../../utils/is/is-undefined.ts';
import { countDecimals } from '../../../utils/number/count-decimals.ts';
import { niceScale, type NiceScale } from '../../../utils/number/nice-scale.ts';
import { roundTo } from '../../../utils/number/round-to.ts';
import { BYTE_UNITS, formatNumber } from '../../runtime/number.ts';

/**
 * How a chart writes its values: a function of the value, or `formatNumber` options.
 */
export type ValueFormat = ((value: number) => string) | NumberFormatOptions;

/**
 * A value axis scale and the label of each of its ticks.
 */
export interface AxisScale extends NiceScale {
  /**
   * Each tick written for the axis.
   */
  labels: string[];
}

/**
 * A chart's value format, resolved for its values and for its axis.
 */
export interface ChartFormat {
  /**
   * Writes a value in full, for a tooltip, a label or the screen reader table.
   */
  value: (value: number) => string;

  /**
   * A scale from `0` that fits `peak` in about `count` steps, with its tick labels.
   */
  scale: (peak: number, count: number, whole: boolean) => AxisScale;
}

/**
 * Resolves a chart's `format`, omitted writing the number in the dashboard language.
 * A function writes the axis too, its ticks stepping by tens.
 * Options let the axis step in the format's own unit, a byte count by powers of 1024.
 * Each tick then carries the decimals its step needs, so neighbours never read alike.
 * Plain numbers go compact on the axis from `1000`, unless `compact` says otherwise.
 */
export function chartFormat(format: ValueFormat | undefined): ChartFormat {
  if (isFunction<(value: number) => string>(format)) {
    return {
      value: format,
      scale: (peak, count, whole) => {
        const scale = niceScale(peak, count, whole);
        return { ...scale, labels: scale.ticks.map((tick) => format(tick)) };
      },
    };
  }
  const options = format ?? {};
  const { bytes = false, currency, percent = false } = options;
  return {
    value: (value) => formatNumber(value, options),
    scale: (peak, count, whole) => {
      const exponent =
        bytes === false ? 0 : bytes === true ? byteExponent(peak) : BYTE_UNITS.indexOf(bytes);
      const size = 1024 ** exponent;
      const scale = niceScale(peak / size, count, whole && exponent === 0);
      const places = countDecimals(roundTo(scale.step * (percent ? 100 : 1), 12));
      const ticks = scale.ticks.map((tick) => tick * size);
      const tickOptions = (tick: number): NumberFormatOptions => {
        if (bytes !== false) return { bytes: BYTE_UNITS[exponent], decimals: places };
        const compact = options.compact ?? (!percent && isUndefined(currency) && tick >= 1000);
        if (compact) return { currency, compact };
        const digits = isUndefined(currency) || places === 0 ? 0 : currencyDigits[currency];
        return { currency, percent, decimals: Math.max(places, digits) };
      };
      return {
        max: scale.max * size,
        step: scale.step * size,
        ticks,
        labels: ticks.map((tick) => formatNumber(tick, tickOptions(tick))),
      };
    },
  };
}
