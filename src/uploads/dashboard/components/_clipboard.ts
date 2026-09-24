import { isUndefined } from 'ohnejs/utils';

/**
 * Copies text that is still being fetched, so the user gesture that permits the write survives the wait.
 * A browser with `ClipboardItem` takes the pending text itself, and the fetch may outlast the gesture.
 * Elsewhere the text is awaited first and written plainly, which a slow fetch may forfeit.
 * Resolves whether the text landed on the clipboard.
 */
export async function copyText(text: Promise<string>): Promise<boolean> {
  try {
    if (isUndefined(globalThis.ClipboardItem)) {
      const value = await text;
      await navigator.clipboard.writeText(value);
    } else {
      const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    }
    return true;
  } catch {
    return false;
  }
}
