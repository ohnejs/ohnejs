import { defineConfig } from 'ohne';

export default defineConfig({
  dirs: {
    api: 'src/layer/api',
    collections: 'src/layer/collections',
    messages: 'src/layer/messages',
    middleware: 'src/layer/middleware',
  },
});
