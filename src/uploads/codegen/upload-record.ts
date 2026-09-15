import type { LayerCodegen } from 'ohnejs';

import { createCodeBuilder } from 'ohnejs/utils/codegen';

/**
 * The codegen entry that types the fields every `Uploads` read adds to the stored columns.
 * Emits `node/upload-record.ts`, merging `UploadDecorations` into the app's generated `Uploads` record.
 * A typed read, populated media fields included, then carries `path`, `url`, and `variants`.
 */
export const uploadRecordCodegen: LayerCodegen = {
  bucket: 'node',
  file: 'upload-record.ts',
  code() {
    const code = createCodeBuilder();
    code.line("import type { ImageVariantName, UploadDecorations } from 'ohnejs/uploads';");
    code.line();
    code.line("import type { GeneratedCollections } from '../shared/database.ts';");
    code.line();
    code.line("declare module 'ohnejs' {");
    code.indent(() => {
      code.line('interface KnownCollections {');
      code.indent(() => {
        code.line(
          "Uploads: GeneratedCollections['Uploads'] & UploadDecorations<ImageVariantName>;",
        );
      });
      code.line('}');
    });
    code.line('}');
    return code.toString();
  },
};
