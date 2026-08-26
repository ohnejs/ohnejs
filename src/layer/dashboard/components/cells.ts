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
import { effect, ref } from 'ohne/utils';

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
  control({ field, mode, path, disabled, onInput }) {
    const t = useT();
    const off = disabled === true;
    const raw = ref('');
    const routed = ref('');
    const revealed = ref(false);

    const error = (): string => routed.value;

    // One persistent button whose icon swaps in place, so a click never unmounts the focused node.
    const reveal = button(
      () => {
        const glyph = icon(revealed.value ? 'eye' : 'eye-off');
        glyph.setAttribute('width', '1.125em');
        glyph.setAttribute('height', '1.125em');
        return glyph;
      },
      {
        variant: 'ghost',
        disabled: off ? (): boolean => true : undefined,
        onClick: () => {
          revealed.value = !revealed.value;
        },
      },
    );
    reveal.tabIndex = -1;
    // The source binds the variant reactively; `button` takes a static one, so the classes patch
    // here. The button's own class attribute has no reactive dependency, so the patch persists.
    effect(() => {
      reveal.classList.toggle('ohne-button-accent', revealed.value);
      reveal.classList.toggle('ohne-button-ghost', !revealed.value);
      reveal.title = t(
        revealed.value ? 'dashboard.field.hidePassword' : 'dashboard.field.showPassword',
      );
    });

    const root = textInput(raw, {
      disabled: () => off,
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
