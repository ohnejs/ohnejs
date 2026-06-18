import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { createKeymap, type KeyStroke } from '../../../src/utils/index.ts';

function stroke(key: string, mods: Partial<Omit<KeyStroke, 'key'>> = {}): KeyStroke {
  return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

describe('createKeymap', () => {
  it('matches a plain key', () => {
    let hit = false;
    const match = createKeymap({ enter: () => void (hit = true) }, { platform: 'linux' });
    strictEqual(match(stroke('Enter')), true);
    strictEqual(hit, true);
  });

  it('returns false when nothing matches', () => {
    const match = createKeymap({ enter: () => true }, { platform: 'linux' });
    strictEqual(match(stroke('a')), false);
  });

  it('resolves mod to meta on macOS', () => {
    const match = createKeymap({ 'mod+z': () => true }, { platform: 'mac' });
    strictEqual(match(stroke('z', { meta: true })), true);
    strictEqual(match(stroke('z', { ctrl: true })), false);
  });

  it('resolves mod to ctrl on Windows and Linux', () => {
    const win = createKeymap({ 'mod+z': () => true }, { platform: 'win' });
    strictEqual(win(stroke('z', { ctrl: true })), true);
    strictEqual(win(stroke('z', { meta: true })), false);

    const linux = createKeymap({ 'mod+z': () => true }, { platform: 'linux' });
    strictEqual(linux(stroke('z', { ctrl: true })), true);
  });

  it('is case-insensitive on the key and modifier order', () => {
    const a = createKeymap({ 'Shift+Mod+Z': () => true }, { platform: 'mac' });
    const b = createKeymap({ 'mod+shift+z': () => true }, { platform: 'mac' });
    const s = stroke('Z', { meta: true, shift: true });
    strictEqual(a(s), true);
    strictEqual(b(s), true);
  });

  it('treats a trailing plus as the plus key', () => {
    const match = createKeymap({ 'mod++': () => true }, { platform: 'mac' });
    strictEqual(match(stroke('+', { meta: true })), true);
  });

  it('ignores spaces around the plus separator', () => {
    const match = createKeymap({ 'ctrl + shift + z': () => true }, { platform: 'linux' });
    strictEqual(match(stroke('z', { ctrl: true, shift: true })), true);
  });

  it('drops a binding whose platforms exclude the target', () => {
    const match = createKeymap(
      { 'ctrl+d': { run: () => true, platforms: ['mac'] } },
      { platform: 'win' },
    );
    strictEqual(match(stroke('d', { ctrl: true })), false);
  });

  it('keeps a binding whose platforms include the target', () => {
    const match = createKeymap(
      { 'ctrl+d': { run: () => true, platforms: ['mac'] } },
      { platform: 'mac' },
    );
    strictEqual(match(stroke('d', { ctrl: true })), true);
  });

  it('treats a command returning false as unhandled', () => {
    const match = createKeymap({ enter: () => false }, { platform: 'linux' });
    strictEqual(match(stroke('Enter')), false);
  });

  it('normalizes space and esc aliases', () => {
    const space = createKeymap({ space: () => true }, { platform: 'linux' });
    strictEqual(space(stroke(' ')), true);
    const esc = createKeymap({ esc: () => true }, { platform: 'linux' });
    strictEqual(esc(stroke('Escape')), true);
  });

  it('throws on an unrecognized modifier', () => {
    throws(
      () => createKeymap({ 'hyper+z': () => true }, { platform: 'mac' }),
      /Unknown key modifier/,
    );
  });
});
