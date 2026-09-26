import {
  bubble,
  button,
  type Child,
  css,
  dropdown,
  type DropdownHandle,
  each,
  h,
  icon,
  type IconName,
  navigate,
  when,
} from 'ohnejs/dashboard';
import { effect, formatBytes, isNull, isUndefined, onCleanup, ref, untracked } from 'ohnejs/utils';

import type { RememberedUpload } from './_remembered-uploads.ts';
import type { UploadStatus, UploadTask } from './upload-queue-state.ts';

import { useUploadsT } from './_messages.ts';
import { mediaPath, splitFileName } from './media-library-state.ts';
import { uploadProgressCircle } from './upload-progress-circle.ts';
import {
  discardInterruptedUpload,
  hideUploadTask,
  interruptedUploads,
  resumeUpload,
  retryUploadTask,
  uploadSpeed,
  uploadTasks,
} from './upload-queue.ts';

/**
 * What a row's round button does; its message key under `uploads.dashboard` names it.
 */
type RowAction = 'abort' | 'retry' | 'resume' | 'hide';

const ACTIVE: readonly UploadStatus[] = ['pending', 'uploading'];

const ACTION_ICONS: Readonly<Record<RowAction, IconName>> = {
  abort: 'circle-off',
  retry: 'refresh',
  resume: 'player-play',
  hide: 'x',
};

css`
  .ohne-dropdown.o-upload-bell-dropdown {
    width: 18rem;
  }

  .o-upload-notifications-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    color: hsl(var(--ohne-muted));
    font-size: 0.75rem;
    font-weight: 500;
  }

  .o-upload-notification {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
  }

  .o-upload-notification-button {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    transition-property: background-color;
    transition: var(--ohne-transition);
  }

  .o-upload-notification:hover .o-upload-notification-button,
  .o-upload-notification:focus .o-upload-notification-button {
    background-color: hsl(var(--ohne-accent) / 0.08);
  }

  .o-upload-notification-button ~ * {
    cursor: pointer;
  }

  .o-upload-notification-status {
    flex-shrink: 0;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid transparent;
    border-radius: 50%;
    font-size: 1rem;
    transition: var(--ohne-transition);
    transition-property: background-color, border-color, color;
  }

  .o-upload-notification-status-completed {
    background-color: hsl(var(--ohne-accent) / 0.16);
  }

  .o-upload-notification-status-failed,
  .o-upload-notification-status-aborted {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .o-upload-notification-status-pending,
  .o-upload-notification-status-interrupted {
    border-color: hsl(var(--ohne-accent) / 0.24);
  }

  .o-upload-notification-status-uploading {
    border: none;
  }

  .o-upload-notification-content {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .o-upload-notification-filename {
    display: flex;
    font-size: 0.8125rem;
    font-weight: 500;
    overflow: hidden;
  }

  .o-upload-notification-filename > :nth-child(2) {
    flex-shrink: 0;
  }

  .o-upload-notification-detail {
    display: block;
    font-size: 0.75rem;
    color: hsl(var(--ohne-muted));
  }

  .o-upload-notification-action-button {
    flex-shrink: 0;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 1.5rem;
    height: 1.5rem;
    margin-left: auto;
    background-color: hsl(var(--ohne-accent) / 0.16);
    border-radius: 50%;
    transition: var(--ohne-transition);
    transition-property: background-color, color;
  }

  .o-upload-notification-action-hide {
    display: none;
  }

  .o-upload-notification:hover .o-upload-notification-action-button,
  .o-upload-notification:focus-within .o-upload-notification-action-button {
    display: flex;
  }

  .o-upload-notification-action-button ~ .o-upload-notification-action-button {
    margin-left: 0.25rem;
  }

  .o-upload-notification-action-button:hover,
  .o-upload-notification-action-button:focus {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }

  .o-upload-notification-action-button.o-upload-notification-action-retry:hover,
  .o-upload-notification-action-button.o-upload-notification-action-retry:focus,
  .o-upload-notification-action-button.o-upload-notification-action-resume:hover,
  .o-upload-notification-action-button.o-upload-notification-action-resume:focus {
    background-color: hsl(var(--ohne-primary));
    color: hsl(var(--ohne-primary-foreground));
  }

  .o-upload-notification-input {
    display: none;
  }
`;

/**
 * The header's upload bell.
 * It renders only while the history holds a task or an interrupted upload, so a quiet dashboard shows none.
 * The trigger carries a bubble with the pending and uploading count and turns primary while open.
 * The dropdown lists every task with a status circle, the split file name, a detail line, and its action.
 * The detail line holds the size, and the bytes sent while uploading; a URL upload shows its host instead.
 * A completed row opens the file's details in the media library; a failed row offers a retry.
 * Below the tasks, each upload an earlier page left open offers to resume once its file is picked again.
 * The header shows the measured speed.
 */
export function uploadBell(): Child {
  return when(() => uploadTasks().length > 0 || interruptedUploads().length > 0, bell);
}

/**
 * The bell proper: the trigger and, while open, the history dropdown anchored to it.
 */
function bell(): HTMLElement {
  const t = useUploadsT();
  const open = ref(false);
  const active = (): number => uploadTasks().filter(({ status }) => ACTIVE.includes(status)).length;

  let panel: DropdownHandle | undefined;

  const close = (): void => {
    open.value = false;
  };

  const trigger = button(icon('upload'), {
    variant: 'outline',
    bubble: when(
      () => active() > 0,
      () => bubble(() => active()),
    ),
    onClick: () => {
      open.value = true;
    },
  });
  effect(() => {
    trigger.title = t('uploads.dashboard.uploadHistory');
  });
  effect(() => {
    trigger.classList.toggle('ohne-button-primary', open.value);
    trigger.classList.toggle('ohne-button-outline', !open.value);
  });

  let resuming: RememberedUpload | undefined;
  const resumeInput = h('input', {
    type: 'file',
    class: 'o-upload-notification-input',
    onChange: () => {
      const file = resumeInput.files?.[0];
      if (!isUndefined(file) && !isUndefined(resuming)) resumeUpload(resuming, file);
      resumeInput.value = '';
    },
  }) as HTMLInputElement;

  const closeIfLast = (): void => {
    if (uploadTasks().length + interruptedUploads().length === 1) close();
  };

  const hide = (id: string): void => {
    closeIfLast();
    hideUploadTask(id);
    panel?.update();
  };

  const discard = (session: string): void => {
    closeIfLast();
    discardInterruptedUpload(session);
    panel?.update();
  };

  const resume = (entry: RememberedUpload): void => {
    resuming = entry;
    resumeInput.click();
  };

  const view = (task: UploadTask): void => {
    close();
    navigate(mediaPath(task.directory, `?details=${task.UUID}`));
  };

  const row = (task: () => UploadTask): HTMLElement => {
    const status = ref(untracked(() => task().status));
    effect(() => {
      status.value = task().status;
    });

    const glyph = (): Child => {
      switch (status.value) {
        case 'completed':
          return icon('check');
        case 'failed':
          return icon('alert-triangle');
        case 'aborted':
          return icon('circle-off');
        case 'pending':
          return icon('clock');
        case 'uploading':
          return uploadProgressCircle(() => (isNull(task().size) ? null : task().progress * 100));
      }
    };

    const detail = (): string => {
      const current = task();
      if (current.status === 'failed') {
        return current.error?.replaceAll('`', '') ?? t('uploads.dashboard.failed');
      }
      if (current.status === 'aborted') return t('uploads.dashboard.aborted');
      if (isNull(current.size)) return current.host ?? '';
      if (current.status !== 'uploading') return formatBytes(current.size);
      if (current.stalled) return t('uploads.dashboard.reconnecting');
      if (current.progress === 1) return t('uploads.dashboard.finishing');
      return `${formatBytes(current.size * current.progress)} / ${formatBytes(current.size)}`;
    };

    return h(
      'div',
      { class: 'o-upload-notification' },
      when(
        () => status.value === 'completed',
        () =>
          h('button', {
            type: 'button',
            class: 'o-upload-notification-button ohne-raw',
            'aria-label': () => t('uploads.dashboard.details'),
            onClick: () => view(task()),
          }),
      ),
      h(
        'span',
        {
          class: () => `o-upload-notification-status o-upload-notification-status-${status.value}`,
          title: () => t(`uploads.dashboard.${status.value}`),
        },
        glyph,
      ),
      h(
        'div',
        { class: 'o-upload-notification-content' },
        fileName(() => task().name),
        h('span', { class: 'o-upload-notification-detail' }, detail),
      ),
      when(
        () => status.value === 'uploading',
        () => actionButton('abort', () => task().abort()),
        () => [
          when(
            () => status.value === 'failed',
            () => actionButton('retry', () => void retryUploadTask(task().id)),
          ),
          actionButton('hide', () => hide(task().id)),
        ],
      ),
    );
  };

  const interruptedRow = (entry: () => RememberedUpload): HTMLElement =>
    h(
      'div',
      { class: 'o-upload-notification' },
      h(
        'span',
        {
          class: 'o-upload-notification-status o-upload-notification-status-interrupted',
          title: () => t('uploads.dashboard.interrupted'),
        },
        icon('circle-dashed'),
      ),
      h(
        'div',
        { class: 'o-upload-notification-content' },
        fileName(() => entry().name),
        h('span', { class: 'o-upload-notification-detail' }, () =>
          t('uploads.dashboard.pickToResume', { name: entry().name }).replaceAll('`', ''),
        ),
      ),
      actionButton('resume', () => resume(entry())),
      actionButton('hide', () => discard(entry().session)),
    );

  return h(
    'div',
    { class: 'ohne-flex' },
    trigger,
    resumeInput,
    when(
      () => open.value,
      () => {
        panel = dropdown(
          [
            h(
              'div',
              { class: 'o-upload-notifications-header' },
              h(
                'span',
                { class: 'ohne-truncate', title: () => t('uploads.dashboard.uploadHistory') },
                () => t('uploads.dashboard.uploadHistory'),
              ),
              when(
                () => (uploadSpeed() ?? 0) > 0,
                () => h('span', null, () => `${formatBytes(uploadSpeed() ?? 0)}/s`),
              ),
            ),
            each(uploadTasks, (task) => task.id, row),
            each(interruptedUploads, (entry) => entry.session, interruptedRow),
          ],
          { reference: trigger, class: 'o-upload-bell-dropdown', onClose: close },
        );
        onCleanup(() => {
          panel = undefined;
        });
        return panel.root;
      },
    ),
  );
}

/**
 * A row's round action button, titled in the viewer's language.
 */
function actionButton(action: RowAction, onClick: () => void): HTMLElement {
  const t = useUploadsT();
  return h(
    'button',
    {
      type: 'button',
      class: `o-upload-notification-action-button o-upload-notification-action-${action} ohne-raw`,
      title: () => t(`uploads.dashboard.${action}`),
      onClick,
    },
    icon(ACTION_ICONS[action]),
  );
}

/**
 * A row's file name, its stem truncated so the extension always shows.
 */
function fileName(name: () => string): HTMLElement {
  return h(
    'span',
    { class: 'o-upload-notification-filename' },
    h('span', { class: 'ohne-truncate' }, () => splitFileName(name()).stem),
    when(
      () => splitFileName(name()).extension !== '',
      () => h('span', null, () => `.${splitFileName(name()).extension}`),
    ),
  );
}
