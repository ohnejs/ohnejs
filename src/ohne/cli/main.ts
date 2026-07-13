import { runCommand } from '../../utils/cli/index.ts';
import { colorOverride } from '../env/color-override.ts';
import { applyEnvFlags, envGlobals } from '../env/env-flags.ts';
import { reportError } from '../error/report-error.ts';
import { ohne } from './ohne.ts';

const argv = process.argv.slice(2);

try {
  applyEnvFlags(argv);
  const code = await runCommand(ohne, argv, { color: colorOverride(), globals: envGlobals() });
  if (code !== 0) process.exitCode = code;
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
