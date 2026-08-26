import {
  button,
  cellEditor,
  describeControl,
  dimMark,
  icon,
  registerFieldType,
  textInput,
  useT,
} from 'ohne/dashboard';
import { ref } from 'ohne/utils';

import './roles-field.ts';

// The hash never reaches the browser: the display is a fixed mark, an emptied editor cancels,
// and a pristine or emptied control omits - a password is never cleared from here.
registerFieldType('password', {
  display() {
    return dimMark('···');
  },
  editor({ commit, cancel }) {
    return cellEditor({
      initial: '',
      type: 'password',
      commit: (text) => (text === '' ? cancel() : commit(text)),
      cancel,
    });
  },
  control({ field, mode, path, onInput }) {
    const t = useT();
    const raw = ref('');
    const routed = ref('');
    const revealed = ref(false);

    const error = (): string => routed.value;

    const reveal = (): HTMLElement => {
      const glyph = icon(revealed.value ? 'eye' : 'eye-off');
      glyph.setAttribute('width', '1.125em');
      glyph.setAttribute('height', '1.125em');
      const toggle = button(glyph, {
        variant: revealed.value ? 'accent' : 'ghost',
        onClick: () => {
          revealed.value = !revealed.value;
        },
      });
      toggle.title = t(
        revealed.value ? 'dashboard.field.hidePassword' : 'dashboard.field.showPassword',
      );
      toggle.tabIndex = -1;
      return toggle;
    };

    const root = textInput(raw, {
      type: () => (revealed.value ? 'text' : 'password'),
      placeholder: mode === 'edit' ? () => t('dashboard.field.unchanged') : undefined,
      autocomplete: 'new-password',
      suffix: reveal,
    });
    const input = root.querySelector('input') as HTMLInputElement;
    input.addEventListener('input', () => {
      routed.value = '';
      onInput();
    });
    describeControl(input, field, path, error);

    return {
      element: root,
      read() {
        return raw.value === '' ? {} : { value: raw.value };
      },
      setErrors(errors) {
        routed.value = errors[''] ?? '';
        for (const [key, message] of Object.entries(errors)) {
          if (key !== '') return message;
        }
        return '';
      },
      error,
      dirty() {
        return raw.value !== '';
      },
      focus() {
        input.focus();
      },
      revert() {
        raw.value = '';
        routed.value = '';
      },
      rebase() {
        raw.value = '';
        routed.value = '';
      },
    };
  },
});
