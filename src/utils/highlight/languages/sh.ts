import type { HighlightToken } from '../highlight-token.ts';

import { scanTokens, type HighlightClassifier } from '../scan-tokens.ts';
import { captureGroup } from './_capture-group.ts';

const GRAMMAR =
  /((?<![^\s])#[^\n]*)|('[^'\n]*'?|"(?:[^"\\\n]|\\.)*"?)|(\$(?:\{[^}\n]*\}?|\w+|[@*#?$!]))|((?<![^\s])--?[A-Za-z][\w-]*)|(\n|&&|\|\||[|;])|\\\n|([^\s'"$#|&;\\]+)|[ \t]+|[\s\S]/y;

const KINDS = ['comment', 'string', 'variable', 'attribute'] as const;

/**
 * The first word of a line, and the first after `&&`, `||`, `|` or `;`, is the command.
 * A word carrying `=` is an assignment before the command, so the slot stays open past it.
 */
function classifyShell(): HighlightClassifier {
  let command = true;
  return (match) => {
    const group = captureGroup(match);
    if (group === 5) command = true;
    if (group === 2 || group === 3) command = false;
    if (group !== 6 || !command || match[0].includes('=')) return KINDS[group - 1];
    command = false;
    return 'keyword';
  };
}

/**
 * Tokenizes shell commands.
 * The command word of each pipeline stage is a keyword, a flag is an attribute.
 *
 * @example
 * ```ts
 * tokenizeShell('pnpm add --save-dev x')
 * // -> [{ kind: 'keyword', start: 0, end: 4 }, { kind: 'attribute', start: 9, end: 19 }]
 * ```
 */
export function tokenizeShell(code: string): HighlightToken[] {
  return scanTokens(code, GRAMMAR, classifyShell());
}
