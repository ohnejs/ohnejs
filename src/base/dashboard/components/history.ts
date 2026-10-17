import { useUnsavedChanges } from 'ohnejs/dashboard';
import { isUndefined, jsonClone, omit, ref } from 'ohnejs/utils';

/**
 * Options for `History`.
 */
export interface HistoryOptions {
  /**
   * List of keys to omit when comparing states.
   *
   * @default
   * []
   */
  omit?: string[];

  /**
   * Maximum number of stored states in history.
   *
   * @default
   * 100
   */
  maxStates?: number;

  /**
   * Whether to guard the instance's dirty state through `useUnsavedChanges`.
   * Leaving the page or closing the tab then asks before it discards the edits.
   * The guard lasts until the reactive scope that built the instance is disposed.
   *
   * @default
   * true
   */
  watchUnsavedChanges?: boolean;
}

/**
 * Data history manager with undo and redo functionality.
 * States are deep-cloned in and out, compared as JSON with the `omit` keys stripped.
 */
export class History<T extends object = Record<string, unknown>> {
  protected states: T[] = [];
  protected omit: string[];
  protected currentIndex = -1;
  protected maxStates: number;
  protected original: T | undefined;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected pending: { state: T; resolve: () => void } | undefined;

  /**
   * Whether a step backward is possible; the first state is the baseline and never undoable.
   */
  readonly canUndo = ref(false);

  /**
   * Whether a step forward is possible.
   */
  readonly canRedo = ref(false);

  /**
   * How many steps backward are possible.
   */
  readonly undoCount = ref(0);

  /**
   * How many steps forward are possible.
   */
  readonly redoCount = ref(0);

  /**
   * Whether the current state, or a pending push that changes it, differs from the original state.
   */
  readonly isDirty = ref(false);

  /**
   * The number of stored states.
   */
  readonly size = ref(0);

  constructor(options?: HistoryOptions) {
    this.omit = options?.omit ?? [];
    this.maxStates = options?.maxStates ?? 100;
    if (options?.watchUnsavedChanges ?? true) useUnsavedChanges(() => this.isDirty.value);
  }

  /**
   * Adds a new state to the history stack and manages the maximum number of stored states.
   * It supersedes a pending debounced push, which then never lands.
   */
  push(state: T): this {
    this.cancelPending();
    const current = this.getCurrentState();
    if (isUndefined(current) || this.differs(state, current)) {
      this.states = this.states.slice(0, this.currentIndex + 1);
      this.states.push(jsonClone(state));
      this.currentIndex++;

      if (this.states.length > this.maxStates) {
        this.states.shift();
        this.currentIndex--;
      }

      if (isUndefined(this.original)) {
        this.setOriginalState(state);
      }
    }

    return this.refresh();
  }

  /**
   * Adds a new state to the history stack once `delay` milliseconds pass without another debounced push.
   * A burst of edits thus lands as one step, and a superseded push never lands.
   * `undo`, `redo` and `flush` land the pending state at once.
   * The reactive refs count a pending state that differs from the current one as already landed.
   */
  pushDebounced(state: T, delay = 500): Promise<this> {
    return new Promise((resolve) => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.pending = { state, resolve: () => resolve(this) };
      this.debounceTimer = setTimeout(() => this.flush(), delay);
      this.refresh();
    });
  }

  /**
   * Lands a pending debounced push now, as its timer would.
   */
  flush(): this {
    const { pending } = this;
    if (isUndefined(pending)) return this;
    this.cancelPending();
    this.push(pending.state);
    pending.resolve();
    return this;
  }

  /**
   * Whether a debounced push waits to land, so an edit now joins its burst.
   */
  isPending(): boolean {
    return !isUndefined(this.pending);
  }

  /**
   * Rewrites the current state with a new state.
   * The `remove` parameter specifies the number of states to remove from the history stack.
   */
  rewrite(state: T, remove = 1): this {
    const removeCount = Math.min(Math.max(1, remove), this.currentIndex + 1);

    if (removeCount > 0) {
      this.states.splice(this.currentIndex - removeCount + 1, removeCount);
      this.currentIndex -= removeCount;
    }

    return this.push(state);
  }

  /**
   * Moves backward in history by one step and returns the previous state.
   * A pending debounced push lands first, so an undo right after typing takes that typing back.
   * Returns `undefined` if there are no states to undo.
   */
  undo(): T | undefined {
    this.flush();
    if (!this.canUndo.value) return undefined;
    this.currentIndex--;
    return jsonClone(this.refresh().states[this.currentIndex]!);
  }

  /**
   * Moves forward in history by one step and returns the next state.
   * A pending debounced push lands first; being a new edit, it leaves nothing to redo.
   * Returns `undefined` if there are no states to redo.
   */
  redo(): T | undefined {
    this.flush();
    if (!this.canRedo.value) return undefined;
    this.currentIndex++;
    return jsonClone(this.refresh().states[this.currentIndex]!);
  }

  /**
   * Returns a copy of the current state, or `undefined` while the history is empty.
   */
  getCurrentState(): T | undefined {
    const state = this.states[this.currentIndex];
    return isUndefined(state) ? undefined : jsonClone(state);
  }

  /**
   * Returns the current history index, where `-1` means no states, `0` the first state, and so on.
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Returns a copy of all states in history.
   */
  getAllStates(): T[] {
    return jsonClone(this.states);
  }

  /**
   * Returns the baseline `isDirty` compares against: the first push, or the last `setOriginalState`.
   */
  getOriginalState(): T | undefined {
    return isUndefined(this.original) ? undefined : jsonClone(this.original);
  }

  /**
   * Makes `state` the baseline `isDirty` compares against, like the state a save just wrote.
   */
  setOriginalState(state: T): this {
    this.original = jsonClone(state);
    return this.refresh();
  }

  /**
   * Removes every state and the original, and cancels a pending debounced push.
   */
  clear(): this {
    this.states = [];
    this.currentIndex = -1;
    this.original = undefined;
    this.cancelPending();
    return this.refresh();
  }

  /**
   * Drops a pending debounced push without landing it.
   */
  protected cancelPending(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pending = undefined;
  }

  /**
   * Re-derives every reactive ref from the stack, the original, and a pending push that changes the state.
   */
  protected refresh(): this {
    const current = this.states[this.currentIndex];
    const pending = this.pending?.state;
    const ahead = !isUndefined(current) && !isUndefined(pending) && this.differs(pending, current);
    this.undoCount.value = ahead
      ? Math.min(this.currentIndex + 1, this.maxStates - 1)
      : this.currentIndex;
    this.redoCount.value = ahead ? 0 : this.states.length - this.currentIndex - 1;
    this.canUndo.value = this.undoCount.value > 0;
    this.canRedo.value = this.redoCount.value > 0;
    this.isDirty.value = this.differs(
      this.original ?? ({} as T),
      (ahead ? pending : current) ?? ({} as T),
    );
    this.size.value = this.states.length;
    return this;
  }

  /**
   * Whether `a` and `b` differ as JSON once the `omit` keys are stripped.
   */
  protected differs(a: T, b: T): boolean {
    const keys = this.omit as (keyof T)[];
    return JSON.stringify(omit(a, keys)) !== JSON.stringify(omit(b, keys));
  }
}
