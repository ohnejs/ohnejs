import type { LayerCodegen } from 'ohnejs';

import { createCodeBuilder, propertyKey } from 'ohnejs/utils/codegen';

import { useAIConfig } from '../config.ts';

/**
 * The codegen entry that types the configured model names.
 * Emits `node/ai-models.ts`, augmenting `KnownAIModels` with one member per `ai.models` entry.
 * `AIModelName` then narrows to the union, so a flow node's `model: 'smrt'` fails to typecheck.
 * The entry runs against the loaded stack, so the app's own `ohne.config.ts` models are typed.
 */
export const aiModelsCodegen: LayerCodegen = {
  bucket: 'node',
  file: 'ai-models.ts',
  code() {
    const names = Object.keys(useAIConfig().models).sort();
    const code = createCodeBuilder();
    code.line("import type {} from 'ohnejs';");
    code.line();
    code.line("declare module 'ohnejs' {");
    code.indent(() => {
      if (names.length === 0) {
        code.line('interface KnownAIModels {}');
      } else {
        code.line('interface KnownAIModels {');
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
