import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  createKeymap,
  deleteKeymap,
  deleteLineKeymap,
  deleteWordKeymap,
  type Keymap,
  type KeyStroke,
  lineStartKeymap,
  moveWordKeymap,
  type Platform,
  redoKeymap,
  strokeFromKeyboardEvent,
  strokeFromReadlineKey,
  undoKeymap,
} from '../../../src/utils/index.ts';

function stroke(key: string, mods: Partial<Omit<KeyStroke, 'key'>> = {}): KeyStroke {
  return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

function matcher(keymap: Keymap, platform: Platform) {
  return createKeymap(keymap, { platform });
}

describe('default keymaps', () => {
  it('binds Ctrl-d for delete only on macOS', () => {
    const onMac = matcher(
      deleteKeymap(() => true),
      'mac',
    );
    strictEqual(onMac(stroke('d', { ctrl: true })), true);
    strictEqual(onMac(stroke('Delete')), true);

    const onWin = matcher(
      deleteKeymap(() => true),
      'win',
    );
    strictEqual(onWin(stroke('d', { ctrl: true })), false);
    strictEqual(onWin(stroke('Delete')), true);
  });

  it('binds undo to Cmd-z on macOS and Ctrl-z elsewhere', () => {
    strictEqual(
      matcher(
        undoKeymap(() => true),
        'mac',
      )(stroke('z', { meta: true })),
      true,
    );
    strictEqual(
      matcher(
        undoKeymap(() => true),
        'win',
      )(stroke('z', { ctrl: true })),
      true,
    );
  });

  it('binds redo on every platform', () => {
    const mac = matcher(
      redoKeymap(() => true),
      'mac',
    );
    strictEqual(mac(stroke('y', { meta: true })), true);
    strictEqual(mac(stroke('z', { meta: true, shift: true })), true);

    const win = matcher(
      redoKeymap(() => true),
      'win',
    );
    strictEqual(win(stroke('y', { ctrl: true })), true);
    strictEqual(win(stroke('z', { ctrl: true, shift: true })), true);

    const linux = matcher(
      redoKeymap(() => true),
      'linux',
    );
    strictEqual(linux(stroke('z', { ctrl: true, shift: true })), true);
  });

  it('routes word delete by direction, Option on macOS and Ctrl elsewhere', () => {
    const calls: string[] = [];
    const mac = matcher(
      deleteWordKeymap(
        () => void calls.push('back'),
        () => void calls.push('forward'),
      ),
      'mac',
    );
    strictEqual(mac(stroke('Backspace', { alt: true })), true);
    strictEqual(mac(stroke('Delete', { alt: true })), true);
    strictEqual(mac(stroke('Backspace', { ctrl: true })), false);
    deepStrictEqual(calls, ['back', 'forward']);

    const linux = matcher(
      deleteWordKeymap(
        () => true,
        () => true,
      ),
      'linux',
    );
    strictEqual(linux(stroke('Backspace', { ctrl: true })), true);
    strictEqual(linux(stroke('Backspace', { alt: true })), false);
  });

  it('routes word motion by direction, Option on macOS and Ctrl elsewhere', () => {
    const calls: string[] = [];
    const mac = matcher(
      moveWordKeymap(
        () => void calls.push('left'),
        () => void calls.push('right'),
      ),
      'mac',
    );
    strictEqual(mac(stroke('ArrowLeft', { alt: true })), true);
    strictEqual(mac(stroke('ArrowRight', { alt: true })), true);
    deepStrictEqual(calls, ['left', 'right']);

    const win = matcher(
      moveWordKeymap(
        () => true,
        () => true,
      ),
      'win',
    );
    strictEqual(win(stroke('ArrowLeft', { ctrl: true })), true);
  });

  it('binds line start to Home everywhere and Cmd-Left on macOS', () => {
    const mac = matcher(
      lineStartKeymap(() => true),
      'mac',
    );
    strictEqual(mac(stroke('Home')), true);
    strictEqual(mac(stroke('ArrowLeft', { meta: true })), true);

    const win = matcher(
      lineStartKeymap(() => true),
      'win',
    );
    strictEqual(win(stroke('Home')), true);
    strictEqual(win(stroke('ArrowLeft', { meta: true })), false);
  });

  it('binds delete-line cross-platform and adds Cmd-Backspace on macOS', () => {
    const mac = matcher(
      deleteLineKeymap(() => true),
      'mac',
    );
    strictEqual(mac(stroke('k', { meta: true, shift: true })), true);
    strictEqual(mac(stroke('Backspace', { meta: true })), true);

    const win = matcher(
      deleteLineKeymap(() => true),
      'win',
    );
    strictEqual(win(stroke('k', { ctrl: true, shift: true })), true);
    strictEqual(win(stroke('Backspace', { meta: true })), false);
  });

  it('fires through the browser adapter', () => {
    const match = matcher(
      undoKeymap(() => true),
      'mac',
    );
    const event = { key: 'z', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true };
    strictEqual(match(strokeFromKeyboardEvent(event)), true);
  });

  it('fires through the readline adapter', () => {
    const match = matcher(
      deleteKeymap(() => true),
      'linux',
    );
    strictEqual(match(strokeFromReadlineKey(undefined, { name: 'delete' })), true);
  });
});
