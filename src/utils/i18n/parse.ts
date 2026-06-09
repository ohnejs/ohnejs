import type { MessageAST, Node, PluralCase, PluralNode, SelectCase, SelectNode } from './ast.ts';

import { last } from '../array/last.ts';
import { MessageSyntaxError } from './errors.ts';

type Cursor = {
  src: string;
  pos: number;
};

const NAME_STOP = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x22, 0x23, 0x27, 0x28, 0x29, 0x2c, 0x3a, 0x3b, 0x3c, 0x3d,
  0x3e, 0x3f, 0x7b, 0x7c, 0x7d,
]);

/**
 * Parses an ICU MessageFormat v1 template into a `MessageAST`.
 * Throws `MessageSyntaxError` on grammar violations.
 *
 * Supported argument types: `number`, `date`, `time`, `plural`, `selectordinal`, `select`.
 * `spellout`, standalone `ordinal`, `duration`, and `choice` are rejected at parse time.
 *
 * The `argStyle` of typed arguments is carried verbatim on the AST node.
 * Skeleton decoding happens at format time.
 *
 * Apostrophe handling follows ICU's `DOUBLE_OPTIONAL` mode.
 * A `'` only opens a quoted region before `{`, `}`, or - inside a plural - `#`.
 * `''` always renders a literal `'`.
 *
 * @example
 * ```ts
 * parse('Hello {name}!')
 * // -> [
 * //      { kind: 'literal', value: 'Hello ' },
 * //      { kind: 'argument', name: 'name' },
 * //      { kind: 'literal', value: '!' },
 * //    ]
 * ```
 */
export function parse(template: string): MessageAST {
  const c: Cursor = { src: template, pos: 0 };
  const ast = parseMessage(c, false, true);

  if (c.pos < c.src.length) {
    throw new MessageSyntaxError("unexpected '}'", c.src, c.pos);
  }

  return ast;
}

function parseMessage(c: Cursor, inPluralBody: boolean, topLevel: boolean): MessageAST {
  const nodes: Node[] = [];
  let literal = '';

  const flushLiteral = () => {
    if (literal.length) {
      nodes.push({ kind: 'literal', value: literal });
      literal = '';
    }
  };

  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;

    if (ch === '}') {
      if (topLevel) throw new MessageSyntaxError("unexpected '}'", c.src, c.pos);
      break;
    }

    if (ch === "'") {
      literal += readQuoted(c, inPluralBody);
      continue;
    }

    if (ch === '{') {
      flushLiteral();
      nodes.push(parseArgument(c, inPluralBody));
      continue;
    }

    if (ch === '#' && inPluralBody) {
      flushLiteral();
      nodes.push({ kind: 'pound' });
      c.pos++;
      continue;
    }

    literal += ch;
    c.pos++;
  }

  flushLiteral();
  return nodes;
}

function readQuoted(c: Cursor, inPluralBody: boolean): string {
  c.pos++;

  if (c.src[c.pos] === "'") {
    c.pos++;
    return "'";
  }

  const next = c.src[c.pos];
  const opensLiteral = next === '{' || next === '}' || (inPluralBody && next === '#');

  if (!opensLiteral) return "'";

  let out = '';

  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;

    if (ch === "'") {
      if (c.src[c.pos + 1] === "'") {
        out += "'";
        c.pos += 2;
        continue;
      }
      c.pos++;
      return out;
    }

    out += ch;
    c.pos++;
  }

  return out;
}

function parseArgument(c: Cursor, inPluralBody: boolean): Node {
  c.pos++;
  skipWhitespace(c);

  const nameStart = c.pos;
  const name = readName(c);
  if (!name) throw new MessageSyntaxError('expected argument name', c.src, nameStart);

  skipWhitespace(c);

  if (c.src[c.pos] === '}') {
    c.pos++;
    return { kind: 'argument', name };
  }

  if (c.src[c.pos] !== ',') {
    throw new MessageSyntaxError("expected ',' or '}' after argument name", c.src, c.pos);
  }
  c.pos++;
  skipWhitespace(c);

  const typeStart = c.pos;
  const type = readName(c);
  if (!type) throw new MessageSyntaxError('expected argument type', c.src, typeStart);

  switch (type) {
    case 'number':
    case 'date':
    case 'time':
      return parseSimpleArg(c, name, type);

    case 'plural':
    case 'selectordinal':
      return parsePlural(c, name, type === 'selectordinal');

    case 'select':
      return parseSelect(c, name, inPluralBody);

    case 'choice':
      throw new MessageSyntaxError(
        'the `choice` format is deprecated; use `plural` with `=N` exact cases',
        c.src,
        typeStart,
      );

    case 'spellout':
    case 'duration':
    case 'ordinal':
      throw new MessageSyntaxError(
        `argument type \`${type}\` requires ICU RBNF, which Intl does not expose`,
        c.src,
        typeStart,
      );

    default:
      throw new MessageSyntaxError(`unknown argument type \`${type}\``, c.src, typeStart);
  }
}

function parseSimpleArg(c: Cursor, name: string, type: 'number' | 'date' | 'time'): Node {
  skipWhitespace(c);

  let style: string | null = null;

  if (c.src[c.pos] === ',') {
    c.pos++;
    skipWhitespace(c);
    const start = c.pos;
    skipStyle(c);
    style = c.src.slice(start, c.pos).trimEnd();
    if (!style) style = null;
  }

  if (c.src[c.pos] !== '}') {
    throw new MessageSyntaxError(`expected '}' to close \`${type}\` argument`, c.src, c.pos);
  }
  c.pos++;

  return { kind: type, name, style };
}

function parsePlural(c: Cursor, name: string, ordinal: boolean): PluralNode {
  const argStart = c.pos;
  skipWhitespace(c);
  if (c.src[c.pos] !== ',') {
    throw new MessageSyntaxError(
      `expected ',' after \`${ordinal ? 'selectordinal' : 'plural'}\``,
      c.src,
      c.pos,
    );
  }
  c.pos++;
  skipWhitespace(c);

  const offset = readOffset(c);
  skipWhitespace(c);

  const cases: PluralCase[] = [];
  let hasOther = false;

  while (c.pos < c.src.length && c.src[c.pos] !== '}') {
    cases.push(readPluralCase(c));
    if (last(cases)!.keyword === 'other') hasOther = true;
    skipWhitespace(c);
  }

  if (!hasOther) {
    throw new MessageSyntaxError(
      `\`${ordinal ? 'selectordinal' : 'plural'}\` is missing the required \`other\` case`,
      c.src,
      argStart,
    );
  }

  if (c.src[c.pos] !== '}') {
    throw new MessageSyntaxError(
      `expected '}' to close \`${ordinal ? 'selectordinal' : 'plural'}\``,
      c.src,
      c.pos,
    );
  }
  c.pos++;

  return { kind: 'plural', name, ordinal, offset, cases };
}

function parseSelect(c: Cursor, name: string, inPluralBody: boolean): SelectNode {
  const argStart = c.pos;
  skipWhitespace(c);
  if (c.src[c.pos] !== ',') {
    throw new MessageSyntaxError("expected ',' after `select`", c.src, c.pos);
  }
  c.pos++;
  skipWhitespace(c);

  const cases: SelectCase[] = [];
  let hasOther = false;

  while (c.pos < c.src.length && c.src[c.pos] !== '}') {
    cases.push(readSelectCase(c, inPluralBody));
    if (last(cases)!.keyword === 'other') hasOther = true;
    skipWhitespace(c);
  }

  if (!hasOther) {
    throw new MessageSyntaxError('`select` is missing the required `other` case', c.src, argStart);
  }

  if (c.src[c.pos] !== '}') {
    throw new MessageSyntaxError("expected '}' to close `select`", c.src, c.pos);
  }
  c.pos++;

  return { kind: 'select', name, cases };
}

function readOffset(c: Cursor): number {
  if (!c.src.startsWith('offset:', c.pos)) return 0;

  c.pos += 'offset:'.length;
  const start = c.pos;

  if (c.src[c.pos] === '-') c.pos++;
  while (c.pos < c.src.length && isDigit(c.src.charCodeAt(c.pos))) c.pos++;

  const raw = c.src.slice(start, c.pos);
  if (!raw || raw === '-') {
    throw new MessageSyntaxError('expected integer after `offset:`', c.src, start);
  }

  return Number(raw);
}

function readPluralCase(c: Cursor): PluralCase {
  let keyword: string;
  let exact: number | null = null;

  if (c.src[c.pos] === '=') {
    c.pos++;
    const start = c.pos;

    if (c.src[c.pos] === '-') c.pos++;
    while (c.pos < c.src.length && isDigit(c.src.charCodeAt(c.pos))) c.pos++;

    const raw = c.src.slice(start, c.pos);
    if (!raw || raw === '-') {
      throw new MessageSyntaxError("expected integer after '='", c.src, start);
    }

    exact = Number(raw);
    keyword = `=${raw}`;
  } else {
    const start = c.pos;
    keyword = readName(c);
    if (!keyword) throw new MessageSyntaxError('expected case selector', c.src, start);
  }

  skipWhitespace(c);
  if (c.src[c.pos] !== '{') {
    throw new MessageSyntaxError("expected '{' to open case body", c.src, c.pos);
  }
  c.pos++;

  const body = parseMessage(c, true, false);

  if (c.src[c.pos] !== '}') {
    throw new MessageSyntaxError("expected '}' to close case body", c.src, c.pos);
  }
  c.pos++;

  return { keyword, exact, body };
}

function readSelectCase(c: Cursor, inPluralBody: boolean): SelectCase {
  const start = c.pos;
  const keyword = readName(c);
  if (!keyword) throw new MessageSyntaxError('expected case selector', c.src, start);

  skipWhitespace(c);
  if (c.src[c.pos] !== '{') {
    throw new MessageSyntaxError("expected '{' to open case body", c.src, c.pos);
  }
  c.pos++;

  const body = parseMessage(c, inPluralBody, false);

  if (c.src[c.pos] !== '}') {
    throw new MessageSyntaxError("expected '}' to close case body", c.src, c.pos);
  }
  c.pos++;

  return { keyword, body };
}

function skipStyle(c: Cursor): void {
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;

    if (ch === '}') return;

    if (ch === "'") {
      c.pos++;
      if (c.src[c.pos] === "'") {
        c.pos++;
        continue;
      }
      while (c.pos < c.src.length && c.src[c.pos] !== "'") {
        c.pos++;
      }
      if (c.pos < c.src.length) c.pos++;
      continue;
    }

    if (ch === '{') {
      let depth = 1;
      c.pos++;
      while (c.pos < c.src.length && depth > 0) {
        const inner = c.src[c.pos]!;
        if (inner === "'") {
          c.pos++;
          if (c.src[c.pos] === "'") {
            c.pos++;
            continue;
          }
          while (c.pos < c.src.length && c.src[c.pos] !== "'") c.pos++;
          if (c.pos < c.src.length) c.pos++;
          continue;
        }
        if (inner === '{') depth++;
        else if (inner === '}') depth--;
        if (depth > 0) c.pos++;
      }
      if (c.pos < c.src.length) c.pos++;
      continue;
    }

    c.pos++;
  }
}

function skipWhitespace(c: Cursor): void {
  while (c.pos < c.src.length && isWhitespace(c.src.charCodeAt(c.pos))) c.pos++;
}

function readName(c: Cursor): string {
  const start = c.pos;
  while (c.pos < c.src.length && isNameChar(c.src.charCodeAt(c.pos))) c.pos++;
  return c.src.slice(start, c.pos);
}

function isNameChar(code: number): boolean {
  return !NAME_STOP.has(code);
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}
