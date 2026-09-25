import { clamp, errorMessage, ref, urlFileName, uuidv7 } from 'ohnejs/utils';

/**
 * Where one queued upload stands.
 */
export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'aborted';

/**
 * One file in the upload queue.
 * A task is an immutable snapshot: every change replaces it in the list, so a keyed row sees a new item.
 */
export interface UploadTask {
  /**
   * A unique id, stable across snapshots.
   */
  id: string;

  /**
   * The file name; once completed, the name the server stored the file under.
   * A URL upload starts with the name its path ends in, else its host.
   */
  name: string;

  /**
   * The target folder path, `''` at the root; once completed, the folder the server stored the file in.
   */
  directory: string;

  /**
   * The file's size in bytes, `null` while unknown.
   * A URL upload learns it from the stored record.
   */
  size: number | null;

  /**
   * The host a URL upload fetches from, shown in place of the URL, whose query may carry a token.
   */
  host?: string;

  /**
   * Where the upload stands.
   */
  status: UploadStatus;

  /**
   * The fraction sent, `0` to `1`.
   */
  progress: number;

  /**
   * Why the upload failed.
   */
  error?: string;

  /**
   * The stored record's `UUID`, once completed.
   */
  UUID?: string;

  /**
   * Aborts the upload while it is pending or uploading; a settled task ignores the call.
   */
  abort(): void;
}

/**
 * A file, or the URL of one, bound for a folder.
 * A file travels as the request body; a URL is fetched by the server.
 */
export type UploadItem = {
  /**
   * The target folder path, `''` at the root.
   */
  directory: string;
} & (
  | {
      /**
       * The file to send.
       */
      file: File;
    }
  | {
      /**
       * The `http:` or `https:` URL the server fetches the file from.
       */
      url: string;
    }
);

/**
 * How one send ended.
 * Success carries what the server stored, since it may have renamed the file.
 */
export type UploadOutcome =
  | { ok: true; UUID: string; name: string; directory: string; size: number | null }
  | { ok: false; error: string };

/**
 * What a sender receives beside the task and its item.
 */
export interface UploadSendHooks {
  /**
   * Aborted when the task's `abort` is called.
   */
  signal: AbortSignal;

  /**
   * Reports the bytes sent so far and the bytes to send in total.
   */
  onProgress(loaded: number, total: number): void;
}

/**
 * Sends one item and answers how it went.
 * A rejection while the signal is aborted marks the task aborted; any other rejection marks it failed.
 */
export type UploadSender = (
  task: UploadTask,
  item: UploadItem,
  hooks: UploadSendHooks,
) => Promise<UploadOutcome>;

/**
 * Options for `createUploadQueue`.
 */
export interface UploadQueueOptions {
  /**
   * How many uploads run at once.
   *
   * @default
   * 5
   */
  concurrency?: number;

  /**
   * The clock the speed measurement reads, in milliseconds.
   *
   * @default
   * () => performance.now()
   */
  now?: () => number;

  /**
   * How far back the speed measurement looks, in milliseconds.
   *
   * @default
   * 3000
   */
  speedWindow?: number;

  /**
   * Called with the final snapshot of every task that completes, fails, or is aborted.
   */
  onSettle?(task: UploadTask): void;
}

/**
 * The upload queue: a reactive task list and the scheduler behind it.
 */
export interface UploadQueue {
  /**
   * Every task, newest batch first, each batch in the order it was given.
   * Reactive.
   */
  tasks(): readonly UploadTask[];

  /**
   * The bytes per second measured over the recent window, `null` before the first measurement.
   * The last measurement stays once the queue drains.
   * Reactive.
   */
  speed(): number | null;

  /**
   * Queues a batch; resolves with the batch's final snapshots once every task in it has settled.
   */
  enqueue(items: readonly UploadItem[]): Promise<readonly UploadTask[]>;

  /**
   * Drops a task from the list; an upload still pending or running continues unseen.
   */
  hide(id: string): void;
}

interface Entry {
  task: UploadTask;
  item: UploadItem;
  controller: AbortController;
  settle(): void;
}

interface Sample {
  at: number;
  bytes: number;
}

const DEFAULT_CONCURRENCY = 5;

const DEFAULT_SPEED_WINDOW = 3000;

// A shorter span holds too few samples to mean anything, so the measurement waits.
const MIN_SPEED_SPAN = 500;

// The fetch route's per-user limit: one more fetch in flight is answered with a `429`.
const MAX_FETCHES = 2;

/**
 * Creates an upload queue around `send`.
 * Tasks start in the order they were queued, at most `concurrency` at once; a settled task frees its slot.
 * URL tasks run at most as many at once as the fetch route allows one user; files pass a URL left waiting.
 * The cap is per queue while the route counts per user, so fetches from another tab can still cause a `429`.
 * Progress arrives from the sender in bytes, so the speed is measured from the deltas over a rolling window.
 * A failure settles only its own task; the rest of the batch runs on.
 *
 * @example
 * ```ts
 * const queue = createUploadQueue(send)
 * await queue.enqueue([{ file, directory: 'photos' }])
 * queue.tasks()[0].status // -> 'completed'
 * ```
 */
export function createUploadQueue(
  send: UploadSender,
  options: UploadQueueOptions = {},
): UploadQueue {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const now = options.now ?? ((): number => performance.now());
  const speedWindow = options.speedWindow ?? DEFAULT_SPEED_WINDOW;
  const tasks = ref<readonly UploadTask[]>([]);
  const speed = ref<number | null>(null);
  const waiting: Entry[] = [];
  const samples: Sample[] = [];
  let running = 0;
  let fetching = 0;

  const snapshot = (id: string): UploadTask | undefined =>
    tasks.value.find((task) => task.id === id);

  const patch = (id: string, changes: Partial<UploadTask>): void => {
    tasks.value = tasks.value.map((task) => (task.id === id ? { ...task, ...changes } : task));
  };

  const finish = (entry: Entry, changes: Partial<UploadTask>): void => {
    const final = { ...(snapshot(entry.task.id) ?? entry.task), ...changes };
    patch(entry.task.id, changes);
    options.onSettle?.(final);
  };

  const measure = (bytes: number): void => {
    const at = now();
    samples.push({ at, bytes });
    while (samples.length > 1 && samples[0].at < at - speedWindow) samples.shift();
    const oldest = samples[0];
    const span = at - oldest.at;
    if (span < MIN_SPEED_SPAN) return;
    const sent = samples.reduce((sum, sample) => sum + sample.bytes, 0) - oldest.bytes;
    speed.value = Math.round((sent / span) * 1000);
  };

  const run = async (entry: Entry): Promise<void> => {
    const { id } = entry.task;
    const { signal } = entry.controller;
    let loaded = 0;
    patch(id, { status: 'uploading' });
    try {
      const outcome = await send(entry.task, entry.item, {
        signal,
        onProgress: (sent, total) => {
          measure(sent - loaded);
          loaded = sent;
          patch(id, { progress: total > 0 ? clamp(sent / total, 0, 1) : 0 });
        },
      });
      if (signal.aborted) return;
      if (outcome.ok) {
        const { UUID, name, directory, size } = outcome;
        finish(entry, { status: 'completed', progress: 1, UUID, name, directory, size });
      } else {
        finish(entry, { status: 'failed', progress: 1, error: outcome.error });
      }
    } catch (error) {
      if (signal.aborted) return;
      finish(entry, { status: 'failed', progress: 1, error: errorMessage(error) });
    }
  };

  const pump = (): void => {
    while (running < concurrency) {
      const index = waiting.findIndex(({ item }) => !('url' in item) || fetching < MAX_FETCHES);
      if (index === -1) return;
      const [entry] = waiting.splice(index, 1);
      const fetches = 'url' in entry.item ? 1 : 0;
      running += 1;
      fetching += fetches;
      void run(entry).finally(() => {
        running -= 1;
        fetching -= fetches;
        entry.settle();
        pump();
      });
    }
  };

  const abort = (entry: Entry): void => {
    const status = snapshot(entry.task.id)?.status;
    if (status !== 'pending' && status !== 'uploading') return;
    const index = waiting.indexOf(entry);
    if (index !== -1) waiting.splice(index, 1);
    finish(entry, { status: 'aborted', progress: 0 });
    entry.controller.abort();
    if (index !== -1) entry.settle();
  };

  const enqueue = (items: readonly UploadItem[]): Promise<readonly UploadTask[]> =>
    new Promise((resolve) => {
      const ids = new Set<string>();
      let outstanding = items.length;
      const settle = (): void => {
        outstanding -= 1;
        if (outstanding === 0) resolve(tasks.value.filter((task) => ids.has(task.id)));
      };
      const batch: UploadTask[] = [];
      for (const item of items) {
        const task: UploadTask = {
          id: uuidv7(),
          ...origin(item),
          directory: item.directory,
          status: 'pending',
          progress: 0,
          abort: () => abort(entry),
        };
        const entry: Entry = { task, item, controller: new AbortController(), settle };
        ids.add(task.id);
        batch.push(task);
        waiting.push(entry);
      }
      tasks.value = [...batch, ...tasks.value];
      if (items.length === 0) resolve([]);
      pump();
    });

  return {
    tasks: () => tasks.value,
    speed: () => speed.value,
    enqueue,
    hide: (id) => {
      tasks.value = tasks.value.filter((task) => task.id !== id);
    },
  };
}

/**
 * The name, size, and host a new task starts with.
 * A URL's name is provisional: the server names the file from the response, and the task takes that on.
 */
function origin(item: UploadItem): Pick<UploadTask, 'name' | 'size' | 'host'> {
  if ('file' in item) return { name: item.file.name, size: item.file.size };
  const host = URL.parse(item.url)?.host ?? '';
  return { name: urlFileName(item.url) || host, size: null, host };
}
