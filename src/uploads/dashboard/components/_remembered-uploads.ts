import {
  isArray,
  isNull,
  isPlainObject,
  isRealNumber,
  isString,
  isUndefined,
  jsonDeserialize,
  ref,
} from 'ohnejs/utils';

/**
 * One open resumable upload, kept across a reload so the same file can continue it.
 */
export interface RememberedUpload {
  /**
   * The session's `UUID`.
   */
  session: string;

  /**
   * The `UUID` of the user who opened the session.
   */
  user: string;

  /**
   * The folder the upload was queued into, as the queue item named it.
   */
  directory: string;

  /**
   * The file's own name.
   */
  name: string;

  /**
   * The file's size in bytes.
   */
  size: number;

  /**
   * The file's `lastModified`, in epoch milliseconds.
   */
  lastModified: number;

  /**
   * The file's media type as the browser reports it, `''` when unknown.
   */
  type: string;

  /**
   * The bytes the server last confirmed.
   */
  offset: number;

  /**
   * The session's chunk size in bytes.
   */
  chunkSize: number;

  /**
   * When the session ends, in epoch milliseconds.
   */
  expiresAt: number;
}

/**
 * The storage `createRememberedUploads` keeps its entries in.
 * In the browser it is `localStorage`, or `sessionStorage` where Web Locks are missing.
 */
export type RememberedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The part of `navigator.locks` the store tells tabs apart through.
 */
export type SessionLocks = Pick<Navigator['locks'], 'request'>;

/**
 * Options for `createRememberedUploads`.
 */
export interface RememberedUploadsOptions {
  /**
   * The storage every entry is kept in.
   */
  storage(): RememberedStorage;

  /**
   * The signed-in user's `UUID`, stamped on each entry it remembers; only that user's entries are listed.
   */
  user(): string | undefined;

  /**
   * The locks that tell whether some tab is sending a session.
   * Without them every session counts as free, so pass a storage only one tab sees.
   */
  locks?: SessionLocks;

  /**
   * The clock an entry's expiry is read against, in epoch milliseconds.
   *
   * @default
   * Date.now
   */
  now?(): number;
}

/**
 * The open resumable uploads a browser remembers, and the ones an earlier page left behind.
 */
export interface RememberedUploads {
  /**
   * The signed-in user's uploads left open when the store was created, once no tab is sending them.
   * An upload whose `hold` is aborted joins them the same way.
   * Each waits for its file to be picked again, until its `expiresAt`.
   * Reactive.
   */
  interrupted(): readonly RememberedUpload[];

  /**
   * Stores `entry` stamped with the signed-in user, in place of the one of the same session.
   */
  remember(entry: Omit<RememberedUpload, 'user'>): void;

  /**
   * Drops the entry of `session`, stored or interrupted.
   */
  forget(session: string): void;

  /**
   * Takes the signed-in user's interrupted upload that `file` continues in `directory` off the list.
   * Answers `undefined` when none matches, or when the match has expired.
   */
  claim(file: File, directory: string): RememberedUpload | undefined;

  /**
   * Runs `send` while this tab holds the lock of `session`, so no other tab lists it as interrupted.
   * While another tab holds it the call waits, and an abort of `signal` ends the wait with its reason.
   * Once `signal` aborts, the session joins the interrupted list as an entry alive at creation does.
   */
  hold<T>(session: string, signal: AbortSignal, send: () => Promise<T>): Promise<T>;

  /**
   * Takes `session` off the interrupted list at once, and forgets it unless another tab is sending it.
   * Answers whether it was forgotten, so its bytes may go too.
   */
  discard(session: string): Promise<boolean>;
}

const KEY = 'ohne-uploads-sessions';

const MAX_ENTRIES = 50;

const TEXT_KEYS = ['session', 'user', 'directory', 'name', 'type'] as const;

const NUMBER_KEYS = ['size', 'lastModified', 'offset', 'chunkSize', 'expiresAt'] as const;

/**
 * Creates the store of open resumable uploads over `storage`, every entry under one key.
 * Each entry alive at creation joins the interrupted list once no tab holds its lock.
 * The entry of an aborted `hold` joins the same way.
 * An entry forgotten by then never joins.
 * So an upload another tab is sending shows only once that tab closes or stops sending.
 * Every read drops the entries whose session has expired by `now`.
 * Neither the list nor `claim` offers an entry once it expires.
 * A write keeps only the newest entries once they pass the cap.
 * A storage that throws, blocked or full, reads as empty and keeps nothing, so a reload loses the resume.
 */
export function createRememberedUploads(options: RememberedUploadsOptions): RememberedUploads {
  const { storage, user, locks, now = Date.now } = options;

  const write = (entries: readonly RememberedUpload[]): void => {
    try {
      if (entries.length === 0) storage().removeItem(KEY);
      else storage().setItem(KEY, JSON.stringify(entries));
    } catch {
      /* only the resume after a reload is lost */
    }
  };

  const read = (): RememberedUpload[] => {
    let raw: string | null;
    try {
      raw = storage().getItem(KEY);
    } catch {
      return [];
    }
    if (isNull(raw)) return [];
    const stored = jsonDeserialize(raw);
    const alive = isArray(stored)
      ? stored.filter(
          (entry): entry is RememberedUpload => isRemembered(entry) && entry.expiresAt > now(),
        )
      : [];
    if (!isArray(stored) || alive.length !== stored.length) write(alive);
    return alive;
  };

  const interrupted = ref<readonly RememberedUpload[]>([]);

  const drop = (session: string): void => {
    if (interrupted.value.some((entry) => entry.session === session)) {
      interrupted.value = interrupted.value.filter((entry) => entry.session !== session);
    }
  };

  const forget = (session: string): void => {
    write(read().filter((entry) => entry.session !== session));
    drop(session);
  };

  const join = (session: string): void => {
    const entry = read().find((candidate) => candidate.session === session);
    if (!isUndefined(entry)) interrupted.value = [...interrupted.value, entry];
  };

  const joinOnceFree = (session: string): void => {
    if (isUndefined(locks)) join(session);
    else void locks.request(lockName(session), () => join(session));
  };

  const offered = (entry: RememberedUpload): boolean =>
    entry.user === user() && entry.expiresAt > now();

  for (const { session } of read()) joinOnceFree(session);

  return {
    interrupted: () => interrupted.value.filter(offered),
    remember: (entry) => {
      const others = read().filter(({ session }) => session !== entry.session);
      write([...others, { ...entry, user: user() ?? '' }].slice(-MAX_ENTRIES));
    },
    forget,
    claim: (file, directory) => {
      const entry = interrupted.value.find(
        (candidate) =>
          offered(candidate) && candidate.directory === directory && matchesFile(candidate, file),
      );
      if (!isUndefined(entry)) drop(entry.session);
      return entry;
    },
    hold: async (session, signal, send) => {
      try {
        return await (isUndefined(locks)
          ? send()
          : locks.request(lockName(session), { signal }, send));
      } finally {
        if (signal.aborted) joinOnceFree(session);
      }
    },
    discard: async (session) => {
      drop(session);
      if (isUndefined(locks)) {
        forget(session);
        return true;
      }
      return locks.request(lockName(session), { ifAvailable: true }, (lock) => {
        if (!isNull(lock)) forget(session);
        return !isNull(lock);
      });
    },
  };
}

/**
 * Whether `file` is the one `entry` was sent from: the same name, size, modification time, and type.
 */
export function matchesFile(entry: RememberedUpload, file: File): boolean {
  return (
    entry.name === file.name &&
    entry.size === file.size &&
    entry.lastModified === file.lastModified &&
    entry.type === file.type
  );
}

/**
 * The name of the lock a tab holds while it sends `session`.
 */
function lockName(session: string): string {
  return `${KEY}:${session}`;
}

/**
 * Whether a stored value has the shape of a `RememberedUpload`.
 */
function isRemembered(value: unknown): value is RememberedUpload {
  return (
    isPlainObject(value) &&
    TEXT_KEYS.every((key) => isString(value[key])) &&
    NUMBER_KEYS.every((key) => isRealNumber(value[key]))
  );
}
