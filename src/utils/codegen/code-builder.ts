/**
 * Options for `createCodeBuilder`.
 */
export interface CodeBuilderOptions {
  /**
   * Spaces per indentation level.
   *
   * @default
   * 2
   */
  size?: number;
}

/**
 * A source-text builder returned by `createCodeBuilder`.
 *
 * Lines are appended at the current indentation level.
 * Every method returns the same builder, so calls chain.
 */
export interface CodeBuilder {
  /**
   * Appends one line at the current indent.
   * Pass nothing for a blank line.
   * Multi-line text is split and each line is indented; embedded blank lines stay blank.
   */
  line(text?: string): CodeBuilder;

  /**
   * Appends each item as its own line at the current indent.
   */
  lines(items: string[]): CodeBuilder;

  /**
   * Runs `build` with the indent raised one level, then restores it.
   * Nest calls for deeper levels.
   */
  indent(build: () => void): CodeBuilder;

  /**
   * Renders the accumulated lines, joined by `\n`, with a trailing newline.
   * Returns `''` when nothing has been appended.
   */
  toString(): string;
}

/**
 * Creates a source-text builder that tracks indentation for you.
 *
 * @example
 * ```ts
 * const c = createCodeBuilder()
 * c.line('const list = [')
 * c.indent(() => c.line('1,'))
 * c.line(']')
 * c.toString() // -> 'const list = [\n  1,\n]\n'
 * ```
 */
export function createCodeBuilder(options: CodeBuilderOptions = {}): CodeBuilder {
  const { size = 2 } = options;
  const out: string[] = [];
  let level = 0;

  const code: CodeBuilder = {
    line(text = '') {
      if (text.length === 0) {
        out.push('');
        return code;
      }
      const pad = ' '.repeat(level * size);
      for (const part of text.split('\n')) out.push(part.length === 0 ? '' : pad + part);
      return code;
    },

    lines(items) {
      for (const item of items) code.line(item);
      return code;
    },

    indent(build) {
      level++;
      build();
      level--;
      return code;
    },

    toString() {
      return out.length === 0 ? '' : out.join('\n') + '\n';
    },
  };

  return code;
}
