import { runCommand } from '../../utils/cli/index.ts';
import { colorOverride } from '../env/color-override.ts';
import { reportError } from '../error/report-error.ts';
import { ohne } from './ohne.ts';

try {
  const code = await runCommand(ohne, process.argv.slice(2), { color: colorOverride() });
  if (code !== 0) process.exitCode = code;
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}
