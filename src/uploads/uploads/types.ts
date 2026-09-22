/**
 * The fields every `Uploads` read adds to the stored columns.
 */
export interface UploadDecorations<Variant extends string = string> {
  /**
   * The location, `directory` and `name` joined: `photos/2024/sunset.jpg`.
   */
  path: string;

  /**
   * Where the bytes are served from: the configured `publicURL` origin, else the backend's own URL.
   * Without either, it is the API's `/uploads/<path>`.
   * A private file's is always the API's, signed with `?e=&s=` while `UPLOADS_SECRET` is set.
   * So is that of a file read without `private`, since it may be one.
   * Absent on a folder, which has no bytes.
   */
  url?: string;

  /**
   * One signed image service URL per configured variant, keyed by name.
   * Present only for an optimizable image when a service is configured.
   */
  variants?: Record<Variant, string>;

  /**
   * When the `url` and `variants` of a private file stop working, in epoch milliseconds.
   * Present only on a private file, or one read without `private`, while `UPLOADS_SECRET` is set.
   */
  expires?: number;
}

/**
 * An `Uploads` record as every read returns it, decorations included.
 */
export interface UploadRecord extends UploadDecorations {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * Whether the row is a file or a folder.
   */
  kind: 'file' | 'folder';

  /**
   * Whether the bytes open only through an expiring link or for a signed-in reader with access.
   * A private folder locks everything inside it.
   * `null` only on a row older than the column, until the boot fills it with `false`; either is public.
   */
  private: boolean | null;

  /**
   * The parent path with no leading slash, `''` at the root.
   */
  directory: string;

  /**
   * The file or folder name, a slug with the file's extension kept.
   */
  name: string;

  /**
   * The file's media type, `null` for a folder.
   */
  type: string | null;

  /**
   * The file's size in bytes, `null` for a folder.
   */
  size: number | null;

  /**
   * The sha256 of the stored bytes in hex, `null` for a folder.
   */
  hash: string | null;

  /**
   * The displayed width in pixels, `null` unless the file is a sized image.
   */
  width: number | null;

  /**
   * The displayed height in pixels, `null` unless the file is a sized image.
   */
  height: number | null;

  /**
   * The alt text in the read's locale, `null` when none is set.
   */
  description: string | null;

  /**
   * The focal point's horizontal position, `0` to `1`, `null` when none is set.
   */
  focalX: number | null;

  /**
   * The focal point's vertical position, `0` to `1`, `null` when none is set.
   */
  focalY: number | null;

  /**
   * The `UUID` of the user who uploaded it, `null` when unknown or the user is gone.
   */
  author: string | null;

  /**
   * When the row was created, in epoch milliseconds.
   */
  uploadedAt: number;

  /**
   * When the row last changed, in epoch milliseconds.
   */
  _updatedAt: number;
}
