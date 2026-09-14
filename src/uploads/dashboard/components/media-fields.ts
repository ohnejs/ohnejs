import { registerFieldType } from 'ohnejs/dashboard';

import { mediaListControl } from './_media-list-control.ts';
import { mediaDisplay, mediaListDisplay } from './media-field-cells.ts';
import { mediaControl, mediaFilter } from './media-field-controls.ts';

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
