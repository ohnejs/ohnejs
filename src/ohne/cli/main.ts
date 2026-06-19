#!/usr/bin/env node
import { runCommand } from '../../utils/cli/index.ts';
import { ohne } from './ohne.ts';

const code = await runCommand(ohne, process.argv.slice(2));
if (code !== 0) process.exitCode = code;
