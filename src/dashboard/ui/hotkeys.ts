import type { Ref } from '../../utils/reactive/ref.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { detectPlatform } from '../../utils/keys/platform.ts';
import { strokeFromKeyboardEvent } from '../../utils/keys/stroke-from-keyboard-event.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { type HotkeyAction, matchHotkey } from './hotkey-match.ts';
import { overlayCount } from './overlay.ts';

/**
 * One independent hotkey instance with its own listener map.
 */
export interface Hotkeys {
  /**
   * Whether the keydown listener is attached.
   * Writable: `pause` and `resume` just flip it.
   */
  isListening: Ref<boolean>;

  /**
   * Whether this instance stays live while an overlay is open.
   * Even then it only fires at the overlay depth it was created at.
   * An instance made inside a popup stands down while a deeper popup is open on top.
   */
  allowInOverlays: Ref<boolean>;

  /**
   * Registers a callback for an action; returns the unsubscribe.
   * Callbacks receive the raw `KeyboardEvent` and must call `preventDefault` themselves.
   */
  listen(action: HotkeyAction, callback: (event: KeyboardEvent) => void): () => void;

  /**
   * Stops listening for keyboard shortcuts.
   */
  pause(): void;

  /**
   * Resumes listening for keyboard shortcuts.
   */
  resume(): void;
}

/**
 * Options for `useHotkeys`.
 */
export interface HotkeysOptions {
  /**
   * Whether hotkeys stay live while an overlay is open.
   *
   * @default
   * false
   */
  allowInOverlays?: boolean;

  /**
   * Actions that keep firing while focus sits in a text-editing element; `save` always does.
   * Listing `undo` and `redo` lets an app's own undo history win over the browser's text undo.
   *
   * @default
   * []
   */
  allowWhileTyping?: HotkeyAction[];

  /**
   * Whether to start listening immediately.
   * Pass `false` with a getter `target`, then `resume` once the surface is mounted.
   *
   * @default
   * true
   */
  listen?: boolean;

  /**
   * The element to listen on, resolved each time listening starts.
   * A getter form lets an instance created before its surface mounts still find the element.
   *
   * @default
   * document
   */
  target?: EventTarget | null | (() => EventTarget | null | undefined);
}

/**
 * Creates an independent keyboard-shortcut instance.
 *
 * The instance pins itself to the overlay depth present shortly after creation.
 * The snapshot defers one tick plus a timeout, so an overlay mounting in the same cycle counts itself first.
 * While any overlay is open, only instances with `allowInOverlays` at exactly that depth fire.
 * The `ohne-no-interaction` body class mutes everything.
 * `save` alone pierces both gates and text editing, so Cmd/Ctrl+S always lands.
 * The `allowWhileTyping` actions pierce text editing as well.
 * Created inside a reactive scope, the listener detaches when the scope disposes.
 * Standalone instances must `pause` themselves.
 *
 * @example
 * ```ts
 * const { listen } = useHotkeys()
 *
 * listen('save', (event) => {
 *   event.preventDefault()
 *   save()
 * })
 * ```
 */
export function useHotkeys(options: HotkeysOptions = {}): Hotkeys {
  const isListening = ref(options.listen ?? true);
  const allowInOverlays = ref(options.allowInOverlays ?? false);
  const allowWhileTyping = options.allowWhileTyping ?? [];
  const listeners = new Map<HotkeyAction, ((event: KeyboardEvent) => void)[]>();
  const mac = isMac();

  let currentOverlay = -1;
  void nextTick().then(() => {
    setTimeout(() => {
      currentOverlay = overlayCount();
    });
  });

  const onKeyDown = (event: Event): void => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.defaultPrevented) return;
    const disabled =
      document.body.classList.contains('ohne-no-interaction') ||
      (overlayCount() > 0 && (!allowInOverlays.value || overlayCount() !== currentOverlay));
    const action = matchHotkey(strokeFromKeyboardEvent(keyboard), {
      mac,
      editing: isEditingText(),
      disabled,
      allowWhileTyping,
    });
    if (action) listeners.get(action)?.forEach((callback) => callback(keyboard));
  };

  let stop: (() => void) | undefined;
  const attach = (): void => {
    const resolved = isFunction<() => EventTarget | null | undefined>(options.target)
      ? options.target()
      : options.target;
    const target = resolved ?? document;
    target.addEventListener('keydown', onKeyDown);
    stop = () => target.removeEventListener('keydown', onKeyDown);
  };
  const detach = (): void => {
    stop?.();
    stop = undefined;
  };
  effect(() => {
    if (isListening.value) untracked(attach);
    else detach();
  });
  onCleanup(detach);

  return {
    isListening,
    allowInOverlays,
    listen: (action, callback) => {
      if (!listeners.has(action)) listeners.set(action, []);
      const callbacks = listeners.get(action)!;
      callbacks.push(callback);
      return () => {
        const at = callbacks.indexOf(callback);
        if (at !== -1) callbacks.splice(at, 1);
      };
    },
    pause: () => (isListening.value = false),
    resume: () => (isListening.value = true),
  };
}

/**
 * Whether focus sits in a text-editing element.
 * Walks from the active element up to `body`.
 * It looks for a non-checkbox input, a textarea, or anything `contenteditable`.
 */
export function isEditingText(): boolean {
  let el = document.activeElement;
  while (el && el.tagName !== 'BODY') {
    if (
      (el.tagName === 'INPUT' && el.getAttribute('type') !== 'checkbox') ||
      el.tagName === 'TEXTAREA' ||
      el.hasAttribute('contenteditable')
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Whether any modifier key is held on the event.
 */
export function hasModifierKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

/**
 * Whether the platform modifier is Command rather than Control.
 */
export function isMac(): boolean {
  return detectPlatform() === 'mac';
}
