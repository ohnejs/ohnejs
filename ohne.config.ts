import { defineConfig } from 'ohnejs';

export default defineConfig({
  dirs: {
    api: 'src/layer/api',
    collections: 'src/layer/collections',
    dashboard: 'src/layer/dashboard',
    fields: 'src/layer/fields',
    messages: 'src/layer/messages',
    middleware: 'src/layer/middleware',
    roles: 'src/layer/roles',
  },
});
