#!/usr/bin/env node
import { runCommand } from '../../utils/cli/index.ts';
import { colorOverride } from '../env/color-override.ts';
import { ohne } from './ohne.ts';

const code = await runCommand(ohne, process.argv.slice(2), { color: colorOverride() });
if (code !== 0) process.exitCode = code;
