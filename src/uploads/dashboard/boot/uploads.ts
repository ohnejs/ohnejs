import { registerTranslatableContext } from 'app/components/content-language-switcher.ts';
import { registerShellSlot } from 'app/components/shell-slots.ts';
import { useRoute } from 'ohnejs/dashboard';

import { dropUploader } from '../components/drop-uploader.ts';
import { uploadsCollection } from '../components/media-library-data.ts';
import { mediaPath } from '../components/media-library-state.ts';
import { registerMediaActions } from '../components/media-library.ts';
import { uploadBell } from '../components/upload-bell.ts';
import { uploadFiles } from '../components/upload-queue.ts';
import '../components/media-fields.ts';

registerTranslatableContext(
  () =>
    (useRoute()?.path.startsWith(mediaPath('')) ?? false) &&
    uploadsCollection()?.translatable === true,
);
registerShellSlot('header', () => uploadBell());
registerShellSlot('global', () => dropUploader());
registerMediaActions({
  onUpload: (files, directory) => void uploadFiles(files.map((file) => ({ file, directory }))),
});
