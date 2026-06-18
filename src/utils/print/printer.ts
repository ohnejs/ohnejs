import type { ANSIColors } from '../ansi/pick-ansi-colors.ts';

import { applyANSIMarkup } from '../ansi/apply-ansi-markup.ts';
import { isColorStream } from '../ansi/is-color-stream.ts';
import { pickANSIColors } from '../ansi/pick-ansi-colors.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';

/**
 * Output level shared by `Printer`'s single-line and `*Block` methods.
 */
export type PrintLevel = 'success' | 'info' | 'warn' | 'error' | 'debug';

/**
 * Argument passed to `Printer.successBlock` and the other `*Block` methods.
 */
export interface BlockOptions {
  /**
   * Single-line title rendered next to the head glyph.
   * Inline markup is processed: backtick spans highlight, `**bold**` bolds, `__dim__` dims.
   *
   * @example
   * ```ts
   * print.errorBlock({ title: 'Build failed', body: 'see logs above' })
   * ```
   */
  title: string;

  /**
   * Body content rendered inside the rail.
   *
   * Accepts either a string (paragraphs separated by `\n\n`) or a `string[]` (each entry is one paragraph).
   * Outer whitespace is trimmed from each paragraph; empty paragraphs are dropped.
   *
   * Within a paragraph, `\n` hard-wraps as one rail-prefixed row per line; internal indentation is preserved.
   * Paragraphs are separated by a bare rail row.
   * Inline markup is processed on each line.
   *
   * @example
   * ```ts
   * print.infoBlock({
   *   title: 'Migration applied',
   *   body: 'first paragraph\n\nsecond paragraph',
   * })
   * ```
   *
   * @example
   * ```ts
   * print.errorBlock({
   *   title: 'Validation failed',
   *   body: errors.map((e) => `${e.path}: ${e.message}`),
   * })
   * ```
   */
  body: string | string[];

  /**
   * Optional reference path.
   *
   * When set, the closing corner becomes `└─ <path>` tinted in the level color.
   * A blank rail row separates it from the body.
   * When omitted, the corner is the bare `└` glyph and there is no trailing blank rail.
   * Markup is NOT processed - paths may legitimately contain backtick or `__` segments.
   *
   * @example
   * ```ts
   * print.errorBlock({
   *   title: 'Type error',
   *   body: 'expected string, got number',
   *   path: 'src/foo.ts:42:3',
   * })
   * ```
   */
  path?: string | undefined;
}

/**
 * Configuration accepted by `createPrinter` and `Printer.configure`.
 */
export interface PrinterConfig {
  /**
   * When `true`, every print call is dropped.
   *
   * @default
   * false
   */
  silent?: boolean | undefined;

  /**
   * When `true`, `Printer.debug` and `Printer.debugBlock` emit.
   * When `false`, debug calls are dropped.
   *
   * @default
   * false
   */
  debug?: boolean | undefined;

  /**
   * When set, overrides TTY auto-detection.
   * `true` always emits ANSI; `false` strips.
   * Leave unset to fall back to the stream's `isTTY`.
   */
  color?: boolean | undefined;

  /**
   * Where rendered output is written.
   * Defaults to `process.stderr` so stdout stays available for tool data output.
   */
  stream?: ({ write(chunk: string): void } & { isTTY?: boolean }) | undefined;
}

/**
 * Terminal-UX writer.
 *
 * Build instances via `createPrinter`.
 *
 * Each severity has two methods:
 * - The bare name (`success`, `info`, ...) renders one line: `●` + message.
 * - The `Block` suffix (`successBlock`, ...) renders a head, an optional rail body, and a `└` corner.
 */
export interface Printer {
  /**
   * Single line: green `●` + message.
   * Inline markup is processed.
   */
  success(message: string): void;

  /**
   * Single line: cyan `●` + message.
   * Inline markup is processed.
   */
  info(message: string): void;

  /**
   * Single line: yellow `●` + message.
   * Inline markup is processed.
   */
  warn(message: string): void;

  /**
   * Single line: red `●` + red-tinted message.
   * Inline markup is processed.
   */
  error(message: string): void;

  /**
   * Single line: gray `●` + message.
   * Suppressed unless `debug` is enabled.
   */
  debug(message: string): void;

  /**
   * Multi-line block: green head, rail body, corner (with optional path).
   */
  successBlock(options: BlockOptions): void;

  /**
   * Multi-line block: cyan head, rail body, corner (with optional path).
   */
  infoBlock(options: BlockOptions): void;

  /**
   * Multi-line block: yellow head, yellow-tinted title, rail body, corner (with optional path).
   */
  warnBlock(options: BlockOptions): void;

  /**
   * Multi-line block: red head, red-tinted title, rail body, corner (with optional path).
   */
  errorBlock(options: BlockOptions): void;

  /**
   * Multi-line block: gray head, dim title, rail body, corner (with optional path).
   * Suppressed unless `debug` is enabled.
   */
  debugBlock(options: BlockOptions): void;

  /**
   * Mutate the printer configuration in place.
   */
  configure(config: Partial<PrinterConfig>): void;
}

const GLYPH_HEAD = '●';
const GLYPH_RAIL = '│';
const GLYPH_CORNER = '└';
const GLYPH_CORNER_DASH = '─';

/**
 * Builds an isolated `Printer`.
 * Use this in tests to avoid coupling to env vars or the global stream.
 *
 * @example
 * ```ts
 * const out: string[] = []
 * const printer = createPrinter({ color: false, stream: { write: (s) => out.push(s) } })
 * printer.success('Done')
 * out.join('') // -> '●  Done\n'
 * ```
 */
export function createPrinter(config: PrinterConfig = {}): Printer {
  const state: {
    silent: boolean;
    debug: boolean;
    color: boolean | undefined;
    stream: NonNullable<PrinterConfig['stream']>;
  } = {
    silent: config.silent ?? false,
    debug: config.debug ?? false,
    color: config.color,
    stream: config.stream ?? process.stderr,
  };

  let colors: ANSIColors = pickANSIColors(state.color ?? isColorStream(state.stream));

  function emitLine(level: PrintLevel, message: string): void {
    if (state.silent) return;
    if (level === 'debug' && !state.debug) return;
    state.stream.write(renderLine(level, message, colors));
  }

  function emitBlock(level: PrintLevel, options: BlockOptions): void {
    if (state.silent) return;
    if (level === 'debug' && !state.debug) return;
    state.stream.write(renderBlock(level, options, colors));
  }

  return {
    success(message) {
      emitLine('success', message);
    },

    info(message) {
      emitLine('info', message);
    },

    warn(message) {
      emitLine('warn', message);
    },

    error(message) {
      emitLine('error', message);
    },

    debug(message) {
      emitLine('debug', message);
    },

    successBlock(options) {
      emitBlock('success', options);
    },

    infoBlock(options) {
      emitBlock('info', options);
    },

    warnBlock(options) {
      emitBlock('warn', options);
    },

    errorBlock(options) {
      emitBlock('error', options);
    },

    debugBlock(options) {
      emitBlock('debug', options);
    },

    configure(partial) {
      if (!isUndefined(partial.silent)) state.silent = partial.silent;
      if (!isUndefined(partial.debug)) state.debug = partial.debug;
      const streamChanged = !isUndefined(partial.stream);
      if (streamChanged) state.stream = partial.stream!;
      const colorChanged = 'color' in partial;
      if (colorChanged) state.color = partial.color;
      if (streamChanged || colorChanged) {
        colors = pickANSIColors(state.color ?? isColorStream(state.stream));
      }
    },
  };
}

function renderLine(level: PrintLevel, message: string, colors: ANSIColors): string {
  const tint = levelTint(level, colors);
  const isError = level === 'error';
  const styled = applyANSIMarkup(message.trim(), isError, colors);
  const final = isError ? colors.red(styled) : styled;
  return `${tint(GLYPH_HEAD)}  ${final}\n`;
}

function renderBlock(level: PrintLevel, options: BlockOptions, colors: ANSIColors): string {
  const tint = levelTint(level, colors);
  const isDebug = level === 'debug';
  const titleTinted = level === 'warn' || level === 'error' || isDebug;
  const boldQuotes = level === 'warn' || level === 'error';
  const titleTint = isDebug ? colors.dim : tint;

  const head = tint(GLYPH_HEAD);
  const rail = tint(GLYPH_RAIL);
  const corner = tint(GLYPH_CORNER);

  const title = options.title.trim();
  const path = options.path?.trim() ?? '';
  const paragraphs = normalizeBody(options.body);

  const styledTitle = applyANSIMarkup(title, boldQuotes, colors);
  const titleLine = `${head}  ${titleTinted ? titleTint(styledTitle) : styledTitle}`;

  const lines: string[] = [titleLine];

  if (paragraphs.length > 0) {
    lines.push(rail);
    for (let i = 0; i < paragraphs.length; i++) {
      if (i > 0) lines.push(rail);
      for (const line of paragraphs[i]!) {
        lines.push(`${rail}  ${applyANSIMarkup(line, false, colors)}`);
      }
    }
  }

  if (path) {
    lines.push(rail);
    lines.push(tint(`${GLYPH_CORNER}${GLYPH_CORNER_DASH} ${path}`));
  } else if (paragraphs.length > 0) {
    lines.push(corner);
  }

  return lines.join('\n') + '\n';
}

function normalizeBody(body: string | string[]): string[][] {
  const raw = isString(body) ? body.split('\n\n') : body;
  const result: string[][] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length > 0) result.push(lines);
  }
  return result;
}

function levelTint(level: PrintLevel, colors: ANSIColors): (text: string) => string {
  switch (level) {
    case 'success':
      return colors.green;

    case 'info':
      return colors.cyan;

    case 'warn':
      return colors.yellow;

    case 'error':
      return colors.red;

    case 'debug':
      return colors.gray;
  }
}
