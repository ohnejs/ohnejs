import type { LayerCodegen } from 'ohne';

import { createCodeBuilder, propertyKey } from 'ohne/utils/codegen';

import { useUploadsConfig } from '../config.ts';

/**
 * The codegen entry that types the configured image variant names.
 * Emits `node/image-variants.ts`, augmenting `KnownImageVariants` with one member per configured name.
 * `ImageVariantName` then narrows to the union, so a typo in `imageURL(upload, 'hero')` fails to typecheck.
 * The entry runs against the loaded stack, so the app's own `ohne.config.ts` variants are typed too.
 */
export const imageVariantsCodegen: LayerCodegen = {
  bucket: 'node',
  file: 'image-variants.ts',
  code() {
    const names = Object.keys(useUploadsConfig().images.variants).sort();
    const code = createCodeBuilder();
    code.line("import type {} from 'ohne/uploads';");
    code.line();
    code.line("declare module 'ohne/uploads' {");
    code.indent(() => {
      if (names.length === 0) {
        code.line('interface KnownImageVariants {}');
      } else {
        code.line('interface KnownImageVariants {');
        code.indent(() => {
          for (const name of names) code.line(`${propertyKey(name)}: true;`);
        });
        code.line('}');
      }
    });
    code.line('}');
    return code.toString();
  },
};
