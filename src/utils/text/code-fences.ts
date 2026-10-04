/**
 * A fenced code block found by `codeFences`.
 */
export interface CodeFence {
  /**
   * The info string after the opening fence, trimmed.
   * Its first word is usually the language.
   */
  info: string;

  /**
   * The text between the fences, without the newline before the closing fence.
   */
  body: string;

  /**
   * Offset in the source where `body` starts.
   */
  start: number;

  /**
   * Offset in the source where `body` ends.
   * Splicing `source.slice(0, start) + next + source.slice(end)` replaces the body and keeps both fences.
   */
  end: number;
}

const OPENING = /^ {0,3}(?<fence>`{3,}|~{3,})(?<info>.*)$/;
const CLOSING = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Lists the fenced code blocks of a Markdown document, in order.
 * A fence opens with three or more backticks or tildes and closes with as many or more of the same.
 * An unclosed fence runs to the end of the document.
 * Backtick fences never carry a backtick in their info string, as in CommonMark.
 *
 * @example
 * ```ts
 * codeFences('Text\n\n~~~js\nlet a = 1\n~~~\n')
 * // -> [{ info: 'js', body: 'let a = 1', start: 12, end: 21 }]
 *
 * codeFences('No code here')
 * // -> []
 * ```
 */
export function codeFences(markdown: string): CodeFence[] {
  const fences: CodeFence[] = [];
  let open: { fence: string; info: string; start: number } | undefined;
  let offset = 0;

  for (const line of markdown.split('\n')) {
    const next = offset + line.length + 1;

    if (!open) {
      const { fence, info } = line.match(OPENING)?.groups ?? {};
      if (fence && !(fence[0] === '`' && info!.includes('`'))) {
        open = { fence, info: info!.trim(), start: next };
      }
    } else {
      const close = line.match(CLOSING)?.[1];
      if (close?.[0] === open.fence[0] && close.length >= open.fence.length) {
        const end = Math.max(open.start, offset - 1);
        fences.push({
          info: open.info,
          body: markdown.slice(open.start, end),
          start: open.start,
          end,
        });
        open = undefined;
      }
    }

    offset = next;
  }

  if (open) {
    const start = Math.min(open.start, markdown.length);
    fences.push({ info: open.info, body: markdown.slice(start), start, end: markdown.length });
  }

  return fences;
}
