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
   * Whether to register the instance on the `unsavedChanges` global.
   * The unsaved-changes surface consults it before the user navigates away from dirty edits.
   *
   * @default
   * true
   */
  watchUnsavedChanges?: boolean;
}

/**
 * The module-global unsaved-changes registration.
 */
export interface UnsavedChanges {
  /**
   * The current `History` instance, registered by the latest watching constructor.
   */
  history: History | null;

  /**
   * Asks the user to confirm leaving dirty edits; resolves whether leaving is allowed.
   * The unsaved-changes surface installs it; while absent, consumers treat consent as given.
   */
  prompt?: () => Promise<boolean>;
}

/**
 * Global reference to the current `history` instance and unsaved changes dialog `prompt` trigger.
 */
export const unsavedChanges: UnsavedChanges = { history: null, prompt: undefined };

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
   * Whether the current state differs from the original state.
   */
  readonly isDirty = ref(false);

  /**
   * The number of stored states.
   */
  readonly size = ref(0);

  constructor(options?: HistoryOptions) {
    this.omit = options?.omit ?? [];
    this.maxStates = options?.maxStates ?? 100;
    if (options?.watchUnsavedChanges ?? true) {
      unsavedChanges.history = this as unknown as History;
    }
  }

  /**
   * Adds a new state to the history stack and manages the maximum number of stored states.
   */
  push(state: T): this {
    const newState = omit(state, this.omit as (keyof T)[]);
    const currentState = omit(this.getCurrentState() ?? ({} as T), this.omit as (keyof T)[]);

    if (JSON.stringify(newState) !== JSON.stringify(currentState)) {
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
   * Adds a new state to the history stack with a debounce `delay` in milliseconds.
   */
  pushDebounced(state: T, delay = 100): Promise<this> {
    return new Promise((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        resolve(this.push(state));
      }, delay);
    });
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
   * Returns `undefined` if there are no states to undo or while a debounced push is pending.
   */
  undo(): T | undefined {
    if (!this.canUndo.value || this.debounceTimer) {
      return undefined;
    }
    this.currentIndex--;
    return jsonClone(this.refresh().states[this.currentIndex]!);
  }

  /**
   * Moves forward in history by one step and returns the next state.
   * Returns `undefined` if there are no states to redo or while a debounced push is pending.
   */
  redo(): T | undefined {
    if (!this.canRedo.value || this.debounceTimer) {
      return undefined;
    }
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
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.refresh();
  }

  /**
   * Re-derives every reactive ref from the stack and the original.
   */
  protected refresh(): this {
    this.canUndo.value = this.currentIndex > 0;
    this.canRedo.value = this.currentIndex < this.states.length - 1;
    this.undoCount.value = this.currentIndex;
    this.redoCount.value = this.states.length - this.currentIndex - 1;
    this.isDirty.value = this.compareOriginalVsCurrentState();
    this.size.value = this.states.length;
    return this;
  }

  /**
   * Whether the current state differs from the original, both with the `omit` keys stripped.
   */
  protected compareOriginalVsCurrentState(): boolean {
    const originalState = omit(this.original ?? ({} as T), this.omit as (keyof T)[]);
    const currentState = omit(this.getCurrentState() ?? ({} as T), this.omit as (keyof T)[]);
    return JSON.stringify(originalState) !== JSON.stringify(currentState);
  }
}
