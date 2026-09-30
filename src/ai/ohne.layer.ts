import { defineLayer } from 'ohnejs';
import { mapKeys } from 'ohnejs/utils';

import { aiModelsCodegen } from './codegen/ai-models.ts';
import { AI_LAYER_STRATEGIES } from './config.ts';

export default defineLayer({
  strategies: mapKeys(AI_LAYER_STRATEGIES, (key) => `ai.${key}`),
  codegen: [aiModelsCodegen],
});
