import { runCommand } from '../../utils/cli/index.ts';
import { colorOverride } from '../env/color-override.ts';
import { applyEnvFlags, envGlobals } from '../env/env-flags.ts';
import { reportError } from '../error/report-error.ts';
import { ohne } from './ohne.ts';
import { withLayerCommands } from './with-layer-commands.ts';

const argv = process.argv.slice(2);

try {
  applyEnvFlags(argv);
  // Read before a layer loads: a flag defined later would be listed but never applied.
  const options = { color: colorOverride(), globals: envGlobals() };
  const code = await runCommand(await withLayerCommands(ohne, argv), argv, options);
  if (code !== 0) process.exitCode = code;
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
