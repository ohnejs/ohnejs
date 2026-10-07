import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { ariaKeyShortcut, detectPlatform } from '../../../src/utils/index.ts';

describe('ariaKeyShortcut', () => {
  it('reads mod as Meta on mac and Control elsewhere', () => {
    strictEqual(ariaKeyShortcut('mod+b', 'mac'), 'Meta+B');
    strictEqual(ariaKeyShortcut('mod+b', 'win'), 'Control+B');
    strictEqual(ariaKeyShortcut('mod+b', 'linux'), 'Control+B');
  });

  it('orders the modifiers regardless of how the spec lists them', () => {
    strictEqual(ariaKeyShortcut('shift+alt+meta+ctrl+a', 'mac'), 'Control+Meta+Alt+Shift+A');
    strictEqual(ariaKeyShortcut('shift+mod+x', 'win'), 'Control+Shift+X');
    strictEqual(ariaKeyShortcut('option+cmd+2', 'mac'), 'Meta+Alt+2');
  });

  it('names keys as `KeyboardEvent.key` does', () => {
    strictEqual(ariaKeyShortcut('esc', 'win'), 'Escape');
    strictEqual(ariaKeyShortcut('delete', 'win'), 'Delete');
    strictEqual(ariaKeyShortcut('alt+f10', 'win'), 'Alt+F10');
    strictEqual(ariaKeyShortcut('mod+arrowup', 'mac'), 'Meta+ArrowUp');
    strictEqual(ariaKeyShortcut('arrowdown', 'mac'), 'ArrowDown');
    strictEqual(ariaKeyShortcut('arrowleft', 'mac'), 'ArrowLeft');
    strictEqual(ariaKeyShortcut('arrowright', 'mac'), 'ArrowRight');
    strictEqual(ariaKeyShortcut('pageup', 'mac'), 'PageUp');
    strictEqual(ariaKeyShortcut('pagedown', 'mac'), 'PageDown');
    strictEqual(ariaKeyShortcut('mod+\\', 'mac'), 'Meta+\\');
  });

  it('spells out the keys the syntax reserves', () => {
    strictEqual(ariaKeyShortcut('shift+space', 'mac'), 'Shift+Space');
    strictEqual(ariaKeyShortcut('mod++', 'mac'), 'Meta+Plus');
  });

  it('defaults to the detected platform', () => {
    strictEqual(ariaKeyShortcut('mod+b'), ariaKeyShortcut('mod+b', detectPlatform()));
  });
});
