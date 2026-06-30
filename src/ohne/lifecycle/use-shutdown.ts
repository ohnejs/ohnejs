import { errorMessage, isUndefined, parseDuration } from '../../utils/index.ts';
import { usePrinter } from '../printer/use-printer.ts';

/**
 * A teardown callback registered with `onShutdown`.
 * Run once when the process is shutting down, in registration order.
 * May be async; the coordinator awaits it before the next hook.
 */
export type ShutdownHook = () => void | Promise<void>;

/**
 * Options for a shutdown run.
 */
export interface ShutdownRunOptions {
  /**
   * Global deadline for every hook combined, as a `parseDuration` value.
   * Omitted means wait for the hooks indefinitely.
   */
  deadline?: number | string;
}

/**
 * Outcome of a shutdown run.
 */
export interface ShutdownOutcome {
  /**
   * `true` if every hook settled before the deadline, `false` if the deadline won first.
   */
  completed: boolean;
}

/**
 * The process-wide shutdown coordinator.
 *
 * Subsystems register teardown with `add`; one signal funnel drives them all.
 * `run` executes the hooks in order under an optional deadline.
 * `watch` wires the signals so a subsystem never registers its own handler.
 */
export interface Shutdown {
  /**
   * Registers a teardown hook.
   * Hooks run in registration order, each awaited before the next.
   */
  add(hook: ShutdownHook): void;

  /**
   * Runs every registered hook in order, bounded by an optional deadline.
   * A hook that throws is logged and the run continues, so one failure cannot strand the others.
   * Idempotent: later calls return the first call's promise.
   */
  run(options?: ShutdownRunOptions): Promise<ShutdownOutcome>;

  /**
   * Installs the signal funnel once, idempotently.
   * `SIGTERM`, `SIGINT`, a `'shutdown'` process message, and a parent `disconnect` all run the hooks.
   * The process then exits `0` on a clean drain or `1` if the deadline won.
   * This is the only place process signals are handled.
   */
  watch(options?: ShutdownRunOptions): void;

  /**
   * Removes the funnel installed by `watch`, detaching every process listener it added.
   * A later `watch` re-installs it, so the pair brackets a server that starts and stops in-process.
   * No-op when not watching.
   */
  unwatch(): void;

  /**
   * Drops every registered hook and resets the run state to `'idle'`.
   * Leaves the signal funnel in place; call `unwatch` to detach it.
   */
  clear(): void;

  /**
   * `'idle'` before a run, `'running'` while hooks are draining, `'done'` once settled.
   */
  readonly state: 'idle' | 'running' | 'done';
}

const hooks = new Set<ShutdownHook>();

let running: Promise<ShutdownOutcome> | undefined;
let state: 'idle' | 'running' | 'done' = 'idle';
let detach: (() => void) | undefined;

const shutdown: Shutdown = {
  add(hook) {
    hooks.add(hook);
  },
  run(options) {
    if (running) return running;
    state = 'running';
    return (running = drain(options).then((outcome) => {
      state = 'done';
      return outcome;
    }));
  },
  watch(options) {
    if (detach) return;
    const trigger = (): void => void exit(options);
    const onMessage = (message: unknown): void => {
      if (message === 'shutdown') trigger();
    };
    process.on('SIGTERM', trigger);
    process.on('SIGINT', trigger);
    process.on('message', onMessage);
    process.on('disconnect', trigger);
    detach = () => {
      process.off('SIGTERM', trigger);
      process.off('SIGINT', trigger);
      process.off('message', onMessage);
      process.off('disconnect', trigger);
    };
  },
  unwatch() {
    detach?.();
    detach = undefined;
  },
  clear() {
    hooks.clear();
    running = undefined;
    state = 'idle';
  },
  get state() {
    return state;
  },
};

/**
 * Returns the process-wide shutdown coordinator.
 *
 * Register teardown with `add` (or the `onShutdown` sugar), drive it with `watch`, run it with `run`.
 * Every arrival path funnels into one ordered run: signals, a process message, a parent disconnect.
 * The job queue and the HTTP server then drain through the same coordinator, with no handler of their own.
 *
 * @example
 * ```ts
 * useShutdown().add(async () => { await db.close() })
 * useShutdown().watch({ deadline: '30s' })
 * ```
 */
export function useShutdown(): Shutdown {
  return shutdown;
}

async function drain(options?: ShutdownRunOptions): Promise<ShutdownOutcome> {
  const all = (async () => {
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        usePrinter().error(`Shutdown hook failed: ${errorMessage(error)}`);
      }
    }
  })();

  const deadline = options?.deadline;
  if (isUndefined(deadline)) {
    await all;
    return { completed: true };
  }

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<ShutdownOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ completed: false }), parseDuration(deadline));
  });
  const outcome = await Promise.race([all.then(() => ({ completed: true })), timeout]);
  clearTimeout(timer!);
  return outcome;
}

async function exit(options?: ShutdownRunOptions): Promise<void> {
  const { completed } = await shutdown.run(options);
  process.exit(completed ? 0 : 1);
}
