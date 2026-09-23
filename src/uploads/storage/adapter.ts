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
   * Opens the object at `path`, whole or by `range`, or resolves `null` when there is none.
   */
  read(path: string, range?: StorageRange): Promise<StorageObject | null>;

  /**
   * The size of the object at `path`, or `null` when there is none.
   */
  stat(path: string): Promise<{ size: number } | null>;

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
}

/**
 * Builds a `StorageAdapter` from the configured `uploads.url`, in whatever form the backend reads it.
 */
export type StorageFactory = (url: string) => StorageAdapter;
