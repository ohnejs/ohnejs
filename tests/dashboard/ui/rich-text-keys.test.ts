import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  RichTextKeyEvent,
  RichTextKeyHandlers,
} from '../../../src/dashboard/ui/rich-text-keys.ts';
import type { Platform, RichTextOptions } from '../../../src/utils/index.ts';

import { matchHotkey } from '../../../src/dashboard/ui/hotkey-match.ts';
import { RICH_TEXT_KEYS, richTextKeys } from '../../../src/dashboard/ui/rich-text-keys.ts';
import { strokeFromKeyboardEvent } from '../../../src/utils/index.ts';

type Mods = Partial<Pick<RichTextKeyEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>>;

/**
 * A keydown with `key` and `code`, where `code` is derived from a letter or digit when omitted.
 */
function event(key: string, mods: Mods = {}, code?: string): RichTextKeyEvent {
  return {
    key,
    code: code ?? (/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`),
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 0,
    ...mods,
  };
}

/**
 * The platform modifier, as `mods` with Command on mac and Control elsewhere.
 */
function mod(platform: Platform, mods: Mods = {}): Mods {
  return platform === 'mac' ? { metaKey: true, ...mods } : { ctrlKey: true, ...mods };
}

/**
 * Handlers that log every call, with `sinkItem` and `liftItem` answering `acts`.
 */
function spy(acts = true): { calls: unknown[][]; handlers: RichTextKeyHandlers } {
  const calls: unknown[][] = [];
  const log =
    (name: string, result?: boolean) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  return {
    calls,
    handlers: {
      toggleMark: log('toggleMark'),
      link: log('link'),
      clearMarks: log('clearMarks'),
      setBlockType: log('setBlockType'),
      toggleList: log('toggleList'),
      sinkItem: log('sinkItem', acts) as () => boolean,
      liftItem: log('liftItem', acts) as () => boolean,
      pastePlain: log('pastePlain'),
      focusToolbar: log('focusToolbar'),
    },
  };
}

/**
 * Runs `keys` on one event and gives the handler calls it made, or `undefined` when it did not match.
 */
function fire(
  options: RichTextOptions,
  platform: Platform,
  keydown: RichTextKeyEvent,
  acts = true,
): unknown[][] | undefined {
  const { calls, handlers } = spy(acts);
  const handled = richTextKeys(options, handlers, { platform })(keydown);
  return handled ? calls : undefined;
}

const ALL: RichTextOptions = {
  elements: ['h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote'],
  marks: ['strong', 'em', 'del', 'code'],
};

const PLATFORMS: Platform[] = ['mac', 'win', 'linux'];

describe('richTextKeys', () => {
  describe('bindings', () => {
    for (const platform of PLATFORMS) {
      it(`binds every shortcut on ${platform}`, () => {
        const cases: [RichTextKeyEvent, unknown[]][] = [
          [event('b', mod(platform)), ['toggleMark', 'strong']],
          [event('i', mod(platform)), ['toggleMark', 'em']],
          [event('e', mod(platform)), ['toggleMark', 'code']],
          [event('X', mod(platform, { shiftKey: true })), ['toggleMark', 'del']],
          [event('k', mod(platform)), ['link']],
          [event('\\', mod(platform), 'Backslash'), ['clearMarks']],
          [event('0', mod(platform, { altKey: true })), ['setBlockType', 'p']],
          [event('2', mod(platform, { altKey: true })), ['setBlockType', 'h2']],
          [event('3', mod(platform, { altKey: true })), ['setBlockType', 'h3']],
          [event('4', mod(platform, { altKey: true })), ['setBlockType', 'h4']],
          [event('5', mod(platform, { altKey: true })), ['setBlockType', 'h5']],
          [event('6', mod(platform, { altKey: true })), ['setBlockType', 'h6']],
          [event('7', mod(platform, { shiftKey: true })), ['toggleList', true]],
          [event('8', mod(platform, { shiftKey: true })), ['toggleList', false]],
          [event('9', mod(platform, { shiftKey: true })), ['setBlockType', 'blockquote']],
          [event(']', mod(platform), 'BracketRight'), ['sinkItem']],
          [event('[', mod(platform), 'BracketLeft'), ['liftItem']],
          [event('V', mod(platform, { shiftKey: true })), ['pastePlain']],
          [event('F10', { altKey: true }, 'F10'), ['focusToolbar']],
          [event('Tab', {}, 'Tab'), ['sinkItem']],
          [event('Tab', { shiftKey: true }, 'Tab'), ['liftItem']],
        ];
        for (const [keydown, call] of cases) {
          deepStrictEqual(fire(ALL, platform, keydown), [call], `${keydown.key} ${keydown.code}`);
        }
      });
    }

    it('uses the other modifier for nothing', () => {
      strictEqual(fire(ALL, 'mac', event('b', { ctrlKey: true })), undefined);
      strictEqual(fire(ALL, 'win', event('b', { metaKey: true })), undefined);
      strictEqual(fire(ALL, 'linux', event('b', { metaKey: true })), undefined);
    });

    it('leaves a bare key, a plain letter and mod+u alone', () => {
      strictEqual(fire(ALL, 'mac', event('b')), undefined);
      strictEqual(fire(ALL, 'mac', event('u', mod('mac'))), undefined);
      strictEqual(fire(ALL, 'mac', event('1', mod('mac', { altKey: true }))), undefined);
      strictEqual(fire(ALL, 'mac', event('Enter', {}, 'Enter')), undefined);
    });

    it('is the table every spec comes from', () => {
      const specs = Object.values(RICH_TEXT_KEYS);
      strictEqual(new Set(specs).size, specs.length);
      strictEqual(RICH_TEXT_KEYS.strong, 'mod+b');
      strictEqual(RICH_TEXT_KEYS.toolbar, 'alt+f10');
    });
  });

  describe('handled', () => {
    it('is false when the handler declines the key', () => {
      const { handlers } = spy();
      handlers.toggleMark = () => false;
      const keys = richTextKeys(ALL, handlers, { platform: 'mac' });
      strictEqual(keys(event('b', mod('mac'))), false);
    });

    it('lets Tab move focus on when the item cannot sink or lift', () => {
      strictEqual(fire(ALL, 'mac', event('Tab', {}, 'Tab'), false), undefined);
      strictEqual(fire(ALL, 'mac', event('Tab', { shiftKey: true }, 'Tab'), false), undefined);
    });

    it('keeps mod+] and mod+[ handled when the item cannot sink or lift', () => {
      deepStrictEqual(fire(ALL, 'mac', event(']', mod('mac'), 'BracketRight'), false), [
        ['sinkItem'],
      ]);
      deepStrictEqual(fire(ALL, 'mac', event('[', mod('mac'), 'BracketLeft'), false), [
        ['liftItem'],
      ]);
    });
  });

  describe('options', () => {
    it('binds only the allowed marks', () => {
      const options: RichTextOptions = { marks: ['em'] };
      strictEqual(fire(options, 'mac', event('b', mod('mac'))), undefined);
      deepStrictEqual(fire(options, 'mac', event('i', mod('mac'))), [['toggleMark', 'em']]);
      strictEqual(fire(options, 'mac', event('e', mod('mac'))), undefined);
      strictEqual(fire(options, 'mac', event('X', mod('mac', { shiftKey: true }))), undefined);
    });

    it('binds the default marks and elements when the options are empty', () => {
      deepStrictEqual(fire({}, 'mac', event('b', mod('mac'))), [['toggleMark', 'strong']]);
      deepStrictEqual(fire({}, 'mac', event('e', mod('mac'))), [['toggleMark', 'code']]);
      strictEqual(fire({}, 'mac', event('X', mod('mac', { shiftKey: true }))), undefined);
      deepStrictEqual(fire({}, 'mac', event('3', mod('mac', { altKey: true }))), [
        ['setBlockType', 'h3'],
      ]);
      strictEqual(fire({}, 'mac', event('4', mod('mac', { altKey: true }))), undefined);
      deepStrictEqual(fire({}, 'mac', event('k', mod('mac'))), [['link']]);
    });

    it('binds only the allowed elements', () => {
      const options: RichTextOptions = { elements: ['h4', 'ul'] };
      deepStrictEqual(fire(options, 'mac', event('0', mod('mac', { altKey: true }))), [
        ['setBlockType', 'p'],
      ]);
      strictEqual(fire(options, 'mac', event('2', mod('mac', { altKey: true }))), undefined);
      deepStrictEqual(fire(options, 'mac', event('4', mod('mac', { altKey: true }))), [
        ['setBlockType', 'h4'],
      ]);
      strictEqual(fire(options, 'mac', event('7', mod('mac', { shiftKey: true }))), undefined);
      deepStrictEqual(fire(options, 'mac', event('8', mod('mac', { shiftKey: true }))), [
        ['toggleList', false],
      ]);
      strictEqual(fire(options, 'mac', event('9', mod('mac', { shiftKey: true }))), undefined);
    });

    it('binds no block type in an inline value', () => {
      const options: RichTextOptions = { ...ALL, inline: true };
      strictEqual(fire(options, 'mac', event('0', mod('mac', { altKey: true }))), undefined);
      strictEqual(fire(options, 'mac', event('2', mod('mac', { altKey: true }))), undefined);
      strictEqual(fire(options, 'mac', event('7', mod('mac', { shiftKey: true }))), undefined);
      strictEqual(fire(options, 'mac', event('9', mod('mac', { shiftKey: true }))), undefined);
      deepStrictEqual(fire(options, 'mac', event('b', mod('mac'))), [['toggleMark', 'strong']]);
    });

    it('leaves mod+k to the palette without links', () => {
      strictEqual(fire({ links: false }, 'mac', event('k', mod('mac'))), undefined);
      deepStrictEqual(fire({ links: true }, 'mac', event('k', mod('mac'))), [['link']]);
      deepStrictEqual(fire({ links: ['Posts'] }, 'mac', event('k', mod('mac'))), [['link']]);
    });

    it('keeps clear formatting, plain paste and the toolbar under every option set', () => {
      const options: RichTextOptions = { inline: true, marks: [], elements: [], links: false };
      deepStrictEqual(fire(options, 'mac', event('\\', mod('mac'), 'Backslash')), [['clearMarks']]);
      deepStrictEqual(fire(options, 'mac', event('V', mod('mac', { shiftKey: true }))), [
        ['pastePlain'],
      ]);
      deepStrictEqual(fire(options, 'mac', event('F10', { altKey: true }, 'F10')), [
        ['focusToolbar'],
      ]);
    });
  });

  describe('digits', () => {
    it('reads the digit from the code when Option changes the key on mac', () => {
      const keydown = event('™', { metaKey: true, altKey: true }, 'Digit2');
      deepStrictEqual(fire(ALL, 'mac', keydown), [['setBlockType', 'h2']]);
    });

    it('reads the digit from the code when Shift changes the key', () => {
      deepStrictEqual(fire(ALL, 'mac', event('&', mod('mac', { shiftKey: true }), 'Digit7')), [
        ['toggleList', true],
      ]);
      deepStrictEqual(fire(ALL, 'win', event('/', mod('win', { shiftKey: true }), 'Digit7')), [
        ['toggleList', true],
      ]);
      deepStrictEqual(fire(ALL, 'linux', event('(', mod('linux', { shiftKey: true }), 'Digit9')), [
        ['setBlockType', 'blockquote'],
      ]);
    });

    it('falls back to the key off the digit row, as on the numpad or without a code', () => {
      deepStrictEqual(fire(ALL, 'mac', event('2', mod('mac', { altKey: true }), 'Numpad2')), [
        ['setBlockType', 'h2'],
      ]);
      deepStrictEqual(fire(ALL, 'mac', event('2', mod('mac', { altKey: true }), '')), [
        ['setBlockType', 'h2'],
      ]);
    });
  });

  describe('AltGr', () => {
    for (const platform of ['win', 'linux'] as const) {
      it(`never takes an AltGr character on ${platform}`, () => {
        const altGr = { ctrlKey: true, altKey: true };
        strictEqual(fire(ALL, platform, event('²', altGr, 'Digit2')), undefined);
        strictEqual(fire(ALL, platform, event('³', altGr, 'Digit3')), undefined);
        strictEqual(fire(ALL, platform, event('{', altGr, 'Digit7')), undefined);
        strictEqual(fire(ALL, platform, event('[', altGr, 'Digit8')), undefined);
        strictEqual(fire(ALL, platform, event(']', altGr, 'Digit9')), undefined);
        strictEqual(fire(ALL, platform, event('}', altGr, 'Digit0')), undefined);
      });

      it(`takes Ctrl-Alt plus a digit that stays a digit on ${platform}`, () => {
        const altGr = { ctrlKey: true, altKey: true };
        deepStrictEqual(fire(ALL, platform, event('2', altGr, 'Digit2')), [['setBlockType', 'h2']]);
        deepStrictEqual(fire(ALL, platform, event('0', altGr, 'Digit0')), [['setBlockType', 'p']]);
      });
    }

    it('does not apply on mac, where Option changes the key', () => {
      const keydown = event('€', { metaKey: true, altKey: true }, 'Digit2');
      deepStrictEqual(fire(ALL, 'mac', keydown), [['setBlockType', 'h2']]);
    });
  });

  describe('composition', () => {
    it('runs no binding while an input method is composing', () => {
      const composing = { ...event('b', mod('mac')), isComposing: true };
      strictEqual(fire(ALL, 'mac', composing), undefined);
      const taken = { ...event('b', mod('mac')), keyCode: 229 };
      strictEqual(fire(ALL, 'mac', taken), undefined);
    });
  });

  describe('dashboard hotkeys', () => {
    for (const platform of PLATFORMS) {
      it(`collides with no dashboard action on ${platform}`, () => {
        const mac = platform === 'mac';
        const context = { mac, editing: false, disabled: false };
        const keydowns: RichTextKeyEvent[] = [
          event('b', mod(platform)),
          event('i', mod(platform)),
          event('e', mod(platform)),
          event('X', mod(platform, { shiftKey: true })),
          event('\\', mod(platform), 'Backslash'),
          event('0', mod(platform, { altKey: true })),
          event('2', mod(platform, { altKey: true })),
          event('6', mod(platform, { altKey: true })),
          event('7', mod(platform, { shiftKey: true })),
          event('8', mod(platform, { shiftKey: true })),
          event('9', mod(platform, { shiftKey: true })),
          event(']', mod(platform), 'BracketRight'),
          event('[', mod(platform), 'BracketLeft'),
          event('V', mod(platform, { shiftKey: true })),
          event('F10', { altKey: true }, 'F10'),
          event('Tab', {}, 'Tab'),
          event('Tab', { shiftKey: true }, 'Tab'),
        ];
        for (const keydown of keydowns) {
          strictEqual(matchHotkey(strokeFromKeyboardEvent(keydown), context), null, keydown.key);
        }
      });

      it(`shares only mod+k with the palette on ${platform}, which stands down once handled`, () => {
        const mac = platform === 'mac';
        const keydown = event('k', mod(platform));
        const stroke = strokeFromKeyboardEvent(keydown);
        const context = {
          mac,
          editing: true,
          disabled: false,
          allowWhileTyping: ['search'] as const,
        };
        strictEqual(matchHotkey(stroke, context), 'search');
        deepStrictEqual(fire(ALL, platform, keydown), [['link']]);
        strictEqual(fire({ links: false }, platform, keydown), undefined);
      });
    }
  });
});
