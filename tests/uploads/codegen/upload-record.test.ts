import { ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { uploadRecordCodegen } from '../../../src/uploads/codegen/upload-record.ts';
import layer from '../../../src/uploads/ohne.layer.ts';

describe('uploadRecordCodegen', () => {
  it('lands in the node bucket as upload-record.ts, declared by the layer', () => {
    strictEqual(uploadRecordCodegen.bucket, 'node');
    strictEqual(uploadRecordCodegen.file, 'upload-record.ts');
    ok(layer.codegen?.includes(uploadRecordCodegen));
  });

  it('types an Uploads read as its generated record plus the decorations', async () => {
    strictEqual(
      await uploadRecordCodegen.code(),
      [
        "import type { ImageVariantName, UploadDecorations } from 'ohnejs/uploads';",
        '',
        "import type { GeneratedCollections } from '../shared/database.ts';",
        '',
        "declare module 'ohnejs' {",
        '  interface KnownCollections {',
        "    Uploads: GeneratedCollections['Uploads'] & UploadDecorations<ImageVariantName>;",
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });
});
