import { defineLayer } from 'ohnejs';

import { AUTH_DEFAULTS } from './auth/config.ts';

export default defineLayer({
  defaults: {
    auth: AUTH_DEFAULTS,
    dashboard: {
      menu: {
        general: { order: 1 },
        collections: { order: 2, label: 'dashboard.menu.collections' },
        management: { order: 3, label: 'dashboard.menu.management' },
        utilities: { order: 4, label: 'dashboard.menu.utilities' },
        overview: {
          parent: 'general',
          order: 1,
          to: '/overview',
          label: 'dashboard.overview.title',
          icon: 'layout-dashboard',
        },
        Users: { parent: 'management', order: 1 },
        Sessions: { hidden: true },
      },
    },
  },
});
