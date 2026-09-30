import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { aiModelsCodegen } from '../../../src/ai/codegen/ai-models.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import '../_fixture.ts';

const PATH = '/ai-models-codegen-test';

describe('aiModelsCodegen', () => {
  afterEach(() => {
    useLayers().remove(PATH);
  });

  it('lands in the node bucket as ai-models.ts', () => {
    strictEqual(aiModelsCodegen.bucket, 'node');
    strictEqual(aiModelsCodegen.file, 'ai-models.ts');
  });

  it('augments KnownAIModels with every configured model, sorted', async () => {
    useLayers().add({
      path: PATH,
      input: {
        ai: {
          models: {
            smart: { provider: 'anthropic', model: 'claude-test', key: false },
            'local-fast': { provider: 'openai-compatible', model: 'qwen', key: false },
          },
        },
      },
    });
    strictEqual(
      await aiModelsCodegen.code(),
      [
        "import type {} from 'ohnejs';",
        '',
        "declare module 'ohnejs' {",
        '  interface KnownAIModels {',
        "    'local-fast': true;",
        '    smart: true;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('leaves the interface empty without models', async () => {
    strictEqual(
      await aiModelsCodegen.code(),
      [
        "import type {} from 'ohnejs';",
        '',
        "declare module 'ohnejs' {",
        '  interface KnownAIModels {}',
        '}',
        '',
      ].join('\n'),
    );
  });
});
