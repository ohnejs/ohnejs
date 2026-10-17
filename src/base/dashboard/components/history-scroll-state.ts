import { useHotkeys } from 'ohnejs/dashboard';
import { nextTick } from 'ohnejs/utils';

/**
 * The scroll surface `historyScrollState` holds.
 * The caller adapts its scroll container to this shape, e.g. wrapping a `ScrollableHandle`.
 */
export interface HistoryScroll {
  /**
   * The current vertical scroll offset in pixels.
   */
  y(): number;

  /**
   * Scrolls the container to `value` instantly.
   */
  setY(value: number): void;
}

/**
 * Renderless scroll holding across undo and redo re-renders.
 *
 * It listens for the `undo` and `redo` hotkeys on `document`, in overlays and while typing alike.
 * On each one it records the scroll offset.
 * Once the re-render flushes, before anything paints, it puts that offset back.
 * A restore that rebuilds the focused control makes the browser clamp the scroll, so the view would jump.
 * Scrolls after that stand, so `historyButtons` can still reveal the field a step changed.
 * Create it before its `historyButtons`, whose listener prevents the keystroke that later listeners skip.
 * Returns `null`, so it can sit in a children list as a renderless member.
 * Create it inside a reactive region; the hotkey listener dies with it.
 */
export function historyScrollState(scroll: HistoryScroll): null {
  const { listen } = useHotkeys({ allowInOverlays: true, allowWhileTyping: ['undo', 'redo'] });

  const hold = (): void => {
    const y = scroll.y();
    void nextTick().then(() => scroll.setY(y));
  };

  listen('undo', hold);
  listen('redo', hold);

  return null;
}
