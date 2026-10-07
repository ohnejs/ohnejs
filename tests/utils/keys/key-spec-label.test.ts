import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { detectPlatform, keySpecLabel } from '../../../src/utils/index.ts';

describe('keySpecLabel', () => {
  it('reads mod as Command on mac and Control elsewhere', () => {
    strictEqual(keySpecLabel('mod+s', 'mac'), 'Cmd + S');
    strictEqual(keySpecLabel('mod+s', 'win'), 'Ctrl + S');
    strictEqual(keySpecLabel('mod+s', 'linux'), 'Ctrl + S');
  });

  it('names each modifier per platform', () => {
    strictEqual(keySpecLabel('ctrl+alt+shift+meta+a', 'mac'), 'Ctrl + Cmd + Option + Shift + A');
    strictEqual(keySpecLabel('ctrl+alt+shift+meta+a', 'win'), 'Ctrl + Win + Alt + Shift + A');
    strictEqual(keySpecLabel('option+cmd+2', 'mac'), 'Cmd + Option + 2');
  });

  it('orders the modifiers regardless of how the spec lists them', () => {
    strictEqual(keySpecLabel('shift+mod+z', 'mac'), 'Cmd + Shift + Z');
    strictEqual(keySpecLabel('mod+shift+z', 'mac'), 'Cmd + Shift + Z');
    strictEqual(keySpecLabel('alt+ctrl+Delete', 'win'), 'Ctrl + Alt + Del');
  });

  it('labels the named keys', () => {
    strictEqual(keySpecLabel('esc', 'win'), 'Esc');
    strictEqual(keySpecLabel('escape', 'win'), 'Esc');
    strictEqual(keySpecLabel('delete', 'win'), 'Del');
    strictEqual(keySpecLabel('mod+arrowup', 'win'), 'Ctrl + ↑');
    strictEqual(keySpecLabel('mod+arrowdown', 'mac'), 'Cmd + ↓');
    strictEqual(keySpecLabel('arrowleft', 'mac'), '←');
    strictEqual(keySpecLabel('arrowright', 'mac'), '→');
    strictEqual(keySpecLabel('space', 'mac'), 'Space');
    strictEqual(keySpecLabel('pageup', 'mac'), 'PgUp');
    strictEqual(keySpecLabel('pagedown', 'mac'), 'PgDn');
    strictEqual(keySpecLabel('enter', 'mac'), 'Enter');
    strictEqual(keySpecLabel('backspace', 'mac'), 'Backspace');
    strictEqual(keySpecLabel('mod+Tab', 'win'), 'Ctrl + Tab');
  });

  it('uppercases a letter and keeps a symbol or digit', () => {
    strictEqual(keySpecLabel('mod+b', 'mac'), 'Cmd + B');
    strictEqual(keySpecLabel('mod+B', 'mac'), 'Cmd + B');
    strictEqual(keySpecLabel('mod+alt+0', 'win'), 'Ctrl + Alt + 0');
    strictEqual(keySpecLabel('mod+\\', 'mac'), 'Cmd + \\');
    strictEqual(keySpecLabel('mod+]', 'mac'), 'Cmd + ]');
    strictEqual(keySpecLabel('mod++', 'mac'), 'Cmd + +');
  });

  it('defaults to the detected platform', () => {
    strictEqual(keySpecLabel('mod+s'), keySpecLabel('mod+s', detectPlatform()));
  });

  it('throws on an unknown modifier', () => {
    throws(() => keySpecLabel('hyper+s', 'mac'), /Unknown key modifier "hyper"/);
  });
});
