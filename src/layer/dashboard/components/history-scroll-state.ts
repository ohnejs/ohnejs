import { useHotkeys } from 'ohne/dashboard';
import { debounce, effect, onCleanup } from 'ohne/utils';

/**
 * The scroll surface `historyScrollState` pins.
 * The caller adapts its scroll container to this shape, e.g. wrapping a `ScrollableHandle`.
 */
export interface HistoryScroll {
  /**
   * The current vertical scroll offset in pixels.
   * Must read a reactive source, such as `ScrollableHandle.y`, so the pinning effect sees changes.
   */
  y(): number;

  /**
   * Scrolls the container to `value` instantly.
   */
  setY(value: number): void;
}

/**
 * Renderless scroll pinning across undo and redo re-renders.
 *
 * It listens for the `undo` and `redo` hotkeys on `document`, in overlays and while typing alike.
 * Its listeners fire alongside the `historyButtons` ones.
 * On each trigger it records the current scroll offset.
 * For 250 milliseconds it then forcibly reverts any scroll change, so DOM-reflow jumps cannot move the view.
 * Another trigger within the window re-records the offset and restarts the timer.
 * Returns `null`, so it can sit in a children list as a renderless member.
 * Create it inside a reactive region; the hotkey listener and the pinning effect die with it.
 */
export function historyScrollState(scroll: HistoryScroll): null {
  const { listen } = useHotkeys({ allowInOverlays: true, allowWhileTyping: ['undo', 'redo'] });
  let pinnedY = 0;
  let stopWatcher: (() => void) | null = null;

  const pause = (): void => {
    stopWatcher?.();
    stopWatcher = null;
  };
  const schedulePause = debounce(pause, 250);

  const trigger = (): void => {
    pinnedY = scroll.y();
    stopWatcher ??= effect(() => {
      if (scroll.y() !== pinnedY) scroll.setY(pinnedY);
    });
    schedulePause();
  };

  listen('undo', trigger);
  listen('redo', trigger);

  onCleanup(() => {
    schedulePause.cancel();
    pause();
  });

  return null;
}
