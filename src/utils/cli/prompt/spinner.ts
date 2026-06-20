import { isColorStream } from '../../ansi/is-color-stream.ts';
import { pickANSIColors } from '../../ansi/pick-ansi-colors.ts';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ERASE_REST = '\x1b[K';
const ERASE_LINE = `\r${ERASE_REST}`;
const CURSOR_UP = '\x1b[1A';
const ETX = '\x03';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Configuration for a spinner.
 */
export interface SpinnerOptions {
  /**
   * Stream keystrokes are captured from while spinning, on a TTY.
   * Captured keys neither echo nor leak into the next prompt.
   *
   * @default
   * process.stdin
   */
  input?: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?(mode: boolean): void };

  /**
   * Stream frames are written to.
   *
   * @default
   * process.stdout
   */
  output?: { write(text: string): void; isTTY?: boolean };

  /**
   * Whether to emit ANSI styling.
   * Defaults to the output stream's `isTTY`.
   */
  color?: boolean;

  /**
   * Glyphs cycled to animate the spin, one per tick.
   *
   * @default
   * ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
   */
  frames?: string[];

  /**
   * Milliseconds between frames.
   *
   * @default
   * 80
   */
  interval?: number;

  /**
   * Whether to draw a connecting rail above the spinner, joining it to a prior prompt.
   * While animating, a trailing rail sits below so the spinner does not hug the edge.
   *
   * @default
   * false
   */
  lead?: boolean;
}

/**
 * A running progress indicator with a mutable message.
 */
export interface Spinner {
  /**
   * Begins spinning with an optional starting message.
   * A second call while already spinning is ignored.
   */
  start(message?: string): void;

  /**
   * Replaces the message shown beside the spinner.
   */
  message(text: string): void;

  /**
   * Stops the spinner, leaving a final line.
   * A non-zero `code` marks failure with a red square instead of the success diamond.
   */
  stop(message?: string, code?: number): void;
}

/**
 * Creates a spinner that animates a single line while async work runs.
 * On a TTY it redraws in place on a timer; off a TTY it logs one line per state change without codes.
 * While spinning on a TTY it captures input so stray keystrokes do not echo, and `ctrl+c` still aborts.
 *
 * @example
 * ```ts
 * const spin = createSpinner()
 * spin.start('Installing')
 * await install()
 * spin.stop('Installed')
 * ```
 */
export function createSpinner(options: SpinnerOptions = {}): Spinner {
  const input: NonNullable<SpinnerOptions['input']> = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const colors = pickANSIColors(options.color ?? isColorStream(output));
  const frames = options.frames ?? FRAMES;
  const interval = options.interval ?? 80;
  const animate = Boolean(output.isTTY);
  const capture = animate && Boolean(input.isTTY);
  const lead = Boolean(options.lead);

  let timer: ReturnType<typeof setInterval> | undefined;
  let index = 0;
  let text = '';
  let active = false;

  const line = (glyph: string, message: string): void => {
    if (!animate) {
      output.write(`${glyph}  ${message}\n`);
      return;
    }
    output.write(`${ERASE_LINE}${glyph}  ${message}`);
    if (lead) output.write(`\n${ERASE_REST}${colors.dim('│')}${CURSOR_UP}`);
  };

  const onData = (chunk: Buffer | string): void => {
    if (!chunk.includes(ETX)) return;
    releaseInput();
    output.write(SHOW_CURSOR);
    process.kill(process.pid, 'SIGINT');
  };

  const captureInput = (): void => {
    input.setRawMode?.(true);
    input.on('data', onData);
    input.resume();
  };

  const releaseInput = (): void => {
    input.off('data', onData);
    input.setRawMode?.(false);
    input.pause();
  };

  return {
    start(message = '') {
      if (active) return;
      active = true;
      text = message;
      index = 0;
      if (lead) output.write(`${colors.dim('│')}\n`);
      if (capture) captureInput();
      if (animate) output.write(HIDE_CURSOR);
      line(colors.cyan(frames[index]), text);
      if (!animate) return;
      timer = setInterval(() => {
        index = (index + 1) % frames.length;
        line(colors.cyan(frames[index]), text);
      }, interval);
      timer.unref?.();
    },

    message(next) {
      text = next;
      if (active) line(colors.cyan(frames[index]), text);
    },

    stop(message = text, code = 0) {
      if (!active) return;
      active = false;
      if (timer) clearInterval(timer);
      timer = undefined;
      if (capture) releaseInput();
      const symbol = code === 0 ? colors.green('◇') : colors.red('■');
      if (animate) {
        output.write(`${ERASE_LINE}${symbol}  ${message}\n`);
        if (lead) output.write(ERASE_REST);
        output.write(SHOW_CURSOR);
      } else {
        output.write(`${symbol}  ${message}\n`);
      }
    },
  };
}
