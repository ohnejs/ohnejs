import { cellEditor, dimMark, registerFieldCell } from 'ohne/dashboard';
import { isArray, isString } from 'ohne/utils';

// The hash never reaches the browser: the display is a fixed mark, and an emptied editor
// cancels instead of clearing a password.
registerFieldCell('password', {
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
});

// Role names edit as a comma-separated list; unknown names reject server-side onto the cell.
registerFieldCell('roles', {
  display({ value }) {
    return () => {
      const current = value();
      if (!isArray(current) || current.length === 0) return dimMark('·');
      return current.filter(isString).join(', ');
    };
  },
  editor({ value, commit, cancel }) {
    const current = value();
    return cellEditor({
      initial: isArray(current) ? current.filter(isString).join(', ') : '',
      commit(text) {
        commit(
          text
            .split(',')
            .map((role) => role.trim())
            .filter((role) => role !== ''),
        );
      },
      cancel,
    });
  },
});
