/**
 * An `Uploads` record as every read returns it, decorations included.
 */
export interface UploadRecord {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * Whether the row is a file or a folder.
   */
  kind: 'file' | 'folder';

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

  /**
   * The location, `directory` and `name` joined: `photos/2024/sunset.jpg`.
   */
  path: string;

  /**
   * Where the bytes are served from: the configured `publicURL` origin, else the API's `/uploads/<path>`.
   * Absent on a folder, which has no bytes.
   */
  url?: string;

  /**
   * A signed image service URL for a small preview.
   * Present only for an optimizable image when a service is configured.
   */
  thumbnail?: string;
}
