import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  type HotkeyContext,
  hotkeyLabels,
  matchHotkey,
} from '../../../src/dashboard/ui/hotkey-match.ts';

function stroke(
  key: string,
  modifiers: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
) {
  return {
    key,
    ctrl: modifiers.ctrl ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    meta: modifiers.meta ?? false,
  };
}

function context(overrides: Partial<HotkeyContext> = {}): HotkeyContext {
  return { mac: false, editing: false, disabled: false, ...overrides };
}

const mac = context({ mac: true });
const win = context();

describe('hotkey matching', () => {
  it('deletes on bare Delete and Backspace, and on Ctrl+D only on mac', () => {
    strictEqual(matchHotkey(stroke('Delete'), win), 'delete');
    strictEqual(matchHotkey(stroke('Backspace'), mac), 'delete');
    strictEqual(matchHotkey(stroke('Delete', { shift: true }), win), null);
    strictEqual(matchHotkey(stroke('d', { ctrl: true }), mac), 'delete');
    strictEqual(matchHotkey(stroke('d', { ctrl: true }), win), 'duplicate');
  });

  it('closes on bare Escape only', () => {
    strictEqual(matchHotkey(stroke('Escape'), win), 'close');
    strictEqual(matchHotkey(stroke('Escape', { shift: true }), win), null);
    strictEqual(matchHotkey(stroke('Escape'), context({ editing: true })), null);
    strictEqual(matchHotkey(stroke('Escape'), context({ disabled: true })), null);
  });

  it('gates on the platform modifier alone', () => {
    strictEqual(matchHotkey(stroke('k', { meta: true }), mac), 'search');
    strictEqual(matchHotkey(stroke('k', { ctrl: true }), mac), null);
    strictEqual(matchHotkey(stroke('k', { ctrl: true }), win), 'search');
    strictEqual(matchHotkey(stroke('k', { meta: true }), win), null);
    strictEqual(matchHotkey(stroke('k', { meta: true, alt: true }), mac), null);
    strictEqual(matchHotkey(stroke('k'), win), null);
  });

  it('resolves undo and redo per platform', () => {
    strictEqual(matchHotkey(stroke('z', { meta: true }), mac), 'undo');
    strictEqual(matchHotkey(stroke('z', { meta: true, shift: true }), mac), 'redo');
    strictEqual(matchHotkey(stroke('y', { meta: true }), mac), 'redo');
    strictEqual(matchHotkey(stroke('z', { ctrl: true }), win), 'undo');
    strictEqual(matchHotkey(stroke('z', { ctrl: true, shift: true }), win), null);
    strictEqual(matchHotkey(stroke('y', { ctrl: true }), win), 'redo');
    strictEqual(matchHotkey(stroke('y', { ctrl: true, shift: true }), win), null);
  });

  it('saves even while editing or disabled', () => {
    strictEqual(
      matchHotkey(stroke('s', { meta: true }), context({ mac: true, editing: true })),
      'save',
    );
    strictEqual(matchHotkey(stroke('s', { ctrl: true }), context({ disabled: true })), 'save');
    strictEqual(matchHotkey(stroke('s', { ctrl: true, shift: true }), win), null);
  });

  it('mutes everything else while editing or disabled', () => {
    strictEqual(matchHotkey(stroke('Delete'), context({ editing: true })), null);
    strictEqual(
      matchHotkey(stroke('c', { meta: true }), context({ mac: true, editing: true })),
      null,
    );
    strictEqual(matchHotkey(stroke('z', { ctrl: true }), context({ disabled: true })), null);
    strictEqual(matchHotkey(stroke('Enter', { ctrl: true }), context({ editing: true })), null);
  });

  it('maps the letters, arrows, and Enter', () => {
    strictEqual(matchHotkey(stroke('a', { ctrl: true }), win), 'selectAll');
    strictEqual(matchHotkey(stroke('c', { ctrl: true }), win), 'copy');
    strictEqual(matchHotkey(stroke('x', { ctrl: true }), win), 'cut');
    strictEqual(matchHotkey(stroke('v', { ctrl: true }), win), 'paste');
    strictEqual(matchHotkey(stroke('d', { meta: true }), mac), 'duplicate');
    strictEqual(matchHotkey(stroke('a', { ctrl: true, shift: true }), win), null);
    strictEqual(matchHotkey(stroke('ArrowUp', { ctrl: true }), win), 'moveUp');
    strictEqual(matchHotkey(stroke('ArrowDown', { meta: true }), mac), 'moveDown');
    strictEqual(matchHotkey(stroke('Enter', { ctrl: true }), win), 'insertAfter');
    strictEqual(matchHotkey(stroke('Enter', { ctrl: true, shift: true }), win), 'insertBefore');
  });
});

describe('hotkey labels', () => {
  it('names the platform modifier', () => {
    strictEqual(hotkeyLabels(true).save, 'Cmd + S');
    strictEqual(hotkeyLabels(false).save, 'Ctrl + S');
    strictEqual(hotkeyLabels(true).close, 'Esc');
    strictEqual(hotkeyLabels(false).delete, 'Del');
    strictEqual(hotkeyLabels(false).moveUp, 'Ctrl + ↑');
  });

  it('labels redo per platform', () => {
    strictEqual(hotkeyLabels(true).redo, 'Cmd + Shift + Z');
    strictEqual(hotkeyLabels(false).redo, 'Ctrl + Y');
  });

  it('labels every action per platform', () => {
    deepStrictEqual(hotkeyLabels(true), {
      close: 'Esc',
      copy: 'Cmd + C',
      cut: 'Cmd + X',
      delete: 'Del',
      duplicate: 'Cmd + D',
      moveDown: 'Cmd + ↓',
      moveUp: 'Cmd + ↑',
      paste: 'Cmd + V',
      redo: 'Cmd + Shift + Z',
      save: 'Cmd + S',
      search: 'Cmd + K',
      selectAll: 'Cmd + A',
      undo: 'Cmd + Z',
    });
    deepStrictEqual(hotkeyLabels(false), {
      close: 'Esc',
      copy: 'Ctrl + C',
      cut: 'Ctrl + X',
      delete: 'Del',
      duplicate: 'Ctrl + D',
      moveDown: 'Ctrl + ↓',
      moveUp: 'Ctrl + ↑',
      paste: 'Ctrl + V',
      redo: 'Ctrl + Y',
      save: 'Ctrl + S',
      search: 'Ctrl + K',
      selectAll: 'Ctrl + A',
      undo: 'Ctrl + Z',
    });
  });
});

describe('hotkeys while typing', () => {
  it('stands down while typing unless the action is allowed', () => {
    const typing = context({ editing: true });
    strictEqual(matchHotkey(stroke('z', { ctrl: true }), typing), null);
    strictEqual(matchHotkey(stroke('y', { ctrl: true }), typing), null);
    strictEqual(matchHotkey(stroke('s', { ctrl: true }), typing), 'save');

    const allowed = context({ editing: true, allowWhileTyping: ['undo', 'redo'] });
    strictEqual(matchHotkey(stroke('z', { ctrl: true }), allowed), 'undo');
    strictEqual(matchHotkey(stroke('y', { ctrl: true }), allowed), 'redo');
    strictEqual(matchHotkey(stroke('a', { ctrl: true }), allowed), null);
    strictEqual(matchHotkey(stroke('Backspace'), allowed), null);
    strictEqual(matchHotkey(stroke('z', { ctrl: true }), { ...allowed, disabled: true }), null);
  });
});
