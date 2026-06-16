import { computed, effect } from '../../utils/index.ts';
import { createPrinter, type Printer } from '../../utils/print/index.ts';
import { useEnv } from '../env/use-env.ts';
import { useConfig } from '../layers/use-config.ts';

const printer: Printer = createPrinter();

const silent = computed(() =>
  useEnv().has('SILENT') ? useEnv().get('SILENT') : useConfig().printer?.silent === true,
);
const debug = computed(() =>
  useEnv().has('DEBUG') ? useEnv().get('DEBUG') : useConfig().printer?.debug === true,
);
const color = computed(() => (useEnv().get('NO_COLOR') ? false : useEnv().get('FORCE_COLOR')));

effect(() => {
  printer.configure({ silent: silent.value, debug: debug.value, color: color.value });
});

/**
 * Returns the process-wide `Printer`.
 *
 * Control output via env vars or `Config.printer`:
 * - `SILENT` / `printer.silent` - drop every call.
 * - `DEBUG` / `printer.debug` - emit `debug` and `debugBlock`.
 * - `NO_COLOR`, `FORCE_COLOR` - ANSI colors (env-only).
 *
 * Env wins when set; `Config.printer` is the fallback.
 * The same instance reflects later changes - call `usePrinter()` once.
 *
 * @example
 * ```ts
 * useLayers().add({ path: '/dev', input: { printer: { debug: true } } })
 * usePrinter().debug('boot complete')
 * ```
 */
export function usePrinter(): Printer {
  return printer;
}
