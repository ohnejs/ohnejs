import { registerFieldType } from 'ohnejs/dashboard';

import { mediaListControl } from './_media-list-control.ts';
import { mediaDisplay, mediaListDisplay } from './media-field-cells.ts';
import { mediaControl, mediaFilter } from './media-field-controls.ts';

/**
 * The options of a `file` field: which uploads it accepts.
 */
export interface FileFieldOptions {
  /**
   * The accepted media types, like `image` or `application/pdf`; omitted, every type.
   */
  types?: readonly string[];

  /**
   * The smallest accepted file, in bytes or as text like `10 KB`.
   */
  minSize?: number | string;

  /**
   * The largest accepted file, in bytes or as text like `5 MB`.
   */
  maxSize?: number | string;
}

/**
 * The options of an `image` field: which uploads it accepts.
 */
export interface ImageFieldOptions extends FileFieldOptions {
  /**
   * The narrowest accepted image, in pixels.
   */
  minWidth?: number;

  /**
   * The widest accepted image, in pixels.
   */
  maxWidth?: number;

  /**
   * The shortest accepted image, in pixels.
   */
  minHeight?: number;

  /**
   * The tallest accepted image, in pixels.
   */
  maxHeight?: number;
}

/**
 * The list bounds of a `files` or `images` field.
 */
export interface MediaListOptions {
  /**
   * Whether an empty list is legal.
   *
   * @default
   * true
   */
  allowEmpty?: boolean;

  /**
   * The fewest uploads the list may hold.
   */
  min?: number;

  /**
   * The most uploads the list may hold.
   */
  max?: number;
}

declare module 'ohnejs/dashboard' {
  interface KnownFieldTypes {
    /**
     * One image upload, by its `UUID`.
     */
    image: { options: ImageFieldOptions; value: string };

    /**
     * One file upload, by its `UUID`.
     */
    file: { options: FileFieldOptions; value: string };

    /**
     * An ordered list of image uploads, by their `UUID`s.
     */
    images: { options: ImageFieldOptions & MediaListOptions; value: string[] };

    /**
     * An ordered list of file uploads, by their `UUID`s.
     */
    files: { options: FileFieldOptions & MediaListOptions; value: string[] };
  }
}

registerFieldType('image', {
  display: mediaDisplay(true),
  control: mediaControl(true),
  filter: mediaFilter(true),
});

registerFieldType('file', {
  display: mediaDisplay(false),
  control: mediaControl(false),
  filter: mediaFilter(false),
});

// A list links through a junction the wire grammar filters with `has`, which the builder's `eq` never emits.
registerFieldType('images', { display: mediaListDisplay(true), control: mediaListControl(true) });

registerFieldType('files', { display: mediaListDisplay(false), control: mediaListControl(false) });
