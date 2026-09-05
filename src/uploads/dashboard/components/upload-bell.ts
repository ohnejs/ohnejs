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
  navigate,
  when,
} from 'ohne/dashboard';
import { effect, formatBytes, onCleanup, ref, untracked } from 'ohne/utils';

import type { UploadStatus, UploadTask } from './upload-queue-state.ts';

import { useUploadsT } from './_messages.ts';
import { mediaPath, splitFileName } from './media-library-state.ts';
import { uploadProgressCircle } from './upload-progress-circle.ts';
import { hideUploadTask, uploadSpeed, uploadTasks } from './upload-queue.ts';

const ACTIVE: readonly UploadStatus[] = ['pending', 'uploading'];

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

  .o-upload-notification-status-pending {
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

  .o-upload-notification-action-button-hide {
    display: none;
  }

  .o-upload-notification:hover .o-upload-notification-action-button,
  .o-upload-notification:focus-within .o-upload-notification-action-button {
    display: flex;
  }

  .o-upload-notification-action-button:hover,
  .o-upload-notification-action-button:focus {
    background-color: hsl(var(--ohne-destructive));
    color: hsl(var(--ohne-destructive-foreground));
  }
`;

/**
 * The header's upload bell.
 * It renders only while the upload history holds a task, so a quiet dashboard shows no bell.
 * The trigger carries a bubble with the pending and uploading count and turns primary while open.
 * The dropdown lists every task with a status circle, the split file name, a detail line, and its action.
 * A completed row opens the file's details in the media library; the header shows the measured speed.
 */
export function uploadBell(): Child {
  return when(() => uploadTasks().length > 0, bell);
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

  const hide = (id: string): void => {
    if (uploadTasks().length === 1) close();
    hideUploadTask(id);
    panel?.update();
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
          return uploadProgressCircle(() => task().progress * 100);
      }
    };

    const detail = (): string => {
      const current = task();
      if (current.status === 'failed') {
        return current.error?.replaceAll('`', '') ?? t('uploads.dashboard.failed');
      }
      if (current.status === 'aborted') return t('uploads.dashboard.aborted');
      return formatBytes(current.size);
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
        h(
          'span',
          { class: 'o-upload-notification-filename' },
          h('span', { class: 'ohne-truncate' }, () => splitFileName(task().name).stem),
          when(
            () => splitFileName(task().name).extension !== '',
            () => h('span', null, () => `.${splitFileName(task().name).extension}`),
          ),
        ),
        h('span', { class: 'o-upload-notification-detail' }, detail),
      ),
      when(
        () => status.value === 'uploading',
        () =>
          h(
            'button',
            {
              type: 'button',
              class: 'o-upload-notification-action-button ohne-raw',
              title: () => t('uploads.dashboard.abort'),
              onClick: () => task().abort(),
            },
            icon('circle-off'),
          ),
        () =>
          h(
            'button',
            {
              type: 'button',
              class:
                'o-upload-notification-action-button o-upload-notification-action-button-hide ohne-raw',
              title: () => t('uploads.dashboard.hide'),
              onClick: () => hide(task().id),
            },
            icon('x'),
          ),
      ),
    );
  };

  return h(
    'div',
    { class: 'ohne-flex' },
    trigger,
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
