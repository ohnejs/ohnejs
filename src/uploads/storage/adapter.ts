/**
 * A byte range of a stored object, both ends inclusive.
 * An omitted `end` runs to the last byte.
 */
export interface StorageRange {
  /**
   * The first byte offset to read.
   */
  start: number;

  /**
   * The last byte offset to read, inclusive.
   */
  end?: number;
}

/**
 * What the layer knows about the bytes it hands to `write`.
 */
export interface StorageWriteMeta {
  /**
   * The media type of the bytes, for a backend that stores one with the object.
   */
  type: string;

  /**
   * The byte length, when the request declared it.
   * A backend that needs the length up front spools or uploads in parts when it is absent.
   */
  size?: number;

  /**
   * How a browser opens the bytes when the backend or `uploads.publicURL` serves them.
   * `attachment` marks a type a browser would run as a document, so it never executes on that origin.
   * A backend that stores headers with its objects keeps it; the API route decides for itself.
   *
   * @default
   * 'inline'
   */
  disposition?: 'attachment' | 'inline';
}

/**
 * A stored object opened for reading.
 */
export interface StorageObject {
  /**
   * The requested bytes, the whole object or the range asked for.
   */
  body: ReadableStream<Uint8Array>;

  /**
   * The size of the whole object in bytes, whatever range `body` covers.
   */
  size: number;
}

/**
 * One part of an object handed to `StorageParts.write`.
 */
export interface StoragePart {
  /**
   * The part's number, from `1`; the layer writes parts in order, each after the one before settled.
   */
  number: number;

  /**
   * The byte offset the part starts at in the object, for a backend that writes in place.
   */
  offset: number;

  /**
   * The part's bytes; every part but the last holds the same count.
   */
  bytes: Uint8Array;
}

/**
 * Part-wise writes: an object assembled from parts that arrive in separate requests.
 * Every part but the last is at least `minSize`, and an object has at most `maxCount` parts.
 * The layer sizes parts from `uploads.chunkSize` and refuses a size below `minSize` at boot.
 */
export interface StorageParts {
  /**
   * The smallest part but the last the backend stores, in bytes; `1` when any size works.
   */
  minSize: number;

  /**
   * The most parts one object may hold; `Infinity` when there is no limit.
   */
  maxCount: number;

  /**
   * Opens a part-wise write to `path` and resolves its handle, an opaque string every later call carries.
   * `meta.size` is always given here.
   * Nothing appears at `path` until `complete`.
   */
  begin(path: string, meta: StorageWriteMeta): Promise<string>;

  /**
   * Stores `part` and resolves its receipt, an opaque string `complete` lists in part order.
   * The same part stored again replaces itself, so a replay is harmless.
   */
  write(path: string, handle: string, part: StoragePart): Promise<string>;

  /**
   * Assembles the parts `receipts` name, in order, into the object at `path`, which appears whole at once.
   * A write that already completed into `path` resolves again, so a retry after a lost answer is harmless.
   */
  complete(path: string, handle: string, receipts: readonly string[]): Promise<void>;

  /**
   * Drops the parts of an unfinished write.
   * A write that is gone, completed or aborted, is a no-op, so a replay is harmless.
   */
  abort(path: string, handle: string): Promise<void>;
}

/**
 * A storage backend the uploads layer keeps files in.
 *
 * Paths are the keys: `photos/2024/sunset.jpg`, no leading slash, every segment a slug.
 * A folder is a prefix, never an object of its own, so an empty folder has no representation here.
 * The backend knows nothing about the database; the layer's helpers keep the two in agreement.
 * Register an implementation from a boot file with `useStorages().register(name, factory)`.
 */
export interface StorageAdapter {
  /**
   * Stores `body` at `path`, replacing whatever is there, atomically once it completes.
   */
  write(path: string, body: ReadableStream<Uint8Array>, meta: StorageWriteMeta): Promise<void>;

  /**
   * Part-wise writes, for a resumable upload whose chunks arrive in separate requests.
   * A backend that cannot assemble an object from stored parts omits it.
   * The layer then answers `501` to a session, and the dashboard sends every file whole.
   */
  parts?: StorageParts;

  /**
   * Opens the object at `path`, whole or by `range`, or resolves `null` when there is none.
   */
  read(path: string, range?: StorageRange): Promise<StorageObject | null>;

  /**
   * The size of the object at `path`, or `null` when there is none.
   */
  stat(path: string): Promise<{ size: number } | null>;

  /**
   * Yields the path of every stored object: the one at `prefix` and every one under `prefix/`.
   * An omitted `prefix` yields every object, and a write still in progress is never among them.
   * A backend that cannot enumerate its objects omits it, and `pruneUploads` then refuses to run.
   */
  list?(prefix?: string): AsyncIterable<string>;

  /**
   * Moves the object at `from` to `to`, or every object under the prefix `from/` beneath `to/`.
   * An existing object at `to` is replaced; a missing `from` is a no-op, so a replay is harmless.
   * An object keeps its visibility as it moves, since a private file moved anywhere stays private.
   */
  move(from: string, to: string): Promise<void>;

  /**
   * Deletes the object at `path` and every object under the prefix `path/`.
   * A missing path is a no-op, so a replay is harmless.
   */
  delete(path: string): Promise<void>;

  /**
   * Marks the object at `path`, or every object under the prefix `path/`, private or public again.
   * `true` locks an object readable without the API, from the backend or through `uploads.publicURL`.
   * A backend whose objects only the API route serves omits it, since the route guards every read.
   * A missing path is a no-op, so a replay is harmless.
   */
  setPrivate?(path: string, value: boolean): Promise<void>;

  /**
   * The public URL of the object at `path`, when the backend serves its objects itself.
   * A backend that leaves serving to the API omits it.
   * A configured `uploads.publicURL` takes precedence over it.
   */
  url?(path: string): string;

  /**
   * Confirms the backend can be reached, throwing an error block that names the cause when it cannot.
   * Every boot runs it before replaying the journal, so a broken backend stops boot with one error.
   */
  check?(): Promise<void>;
}

/**
 * Builds a `StorageAdapter` from the configured `uploads.url`, in whatever form the backend reads it.
 */
export type StorageFactory = (url: string) => StorageAdapter;
