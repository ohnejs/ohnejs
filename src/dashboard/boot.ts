import { startRouter } from './router/router.ts';
import { dashboardConfig } from './runtime/config.ts';

void startRouter(dashboardConfig().pages, document.getElementById('app') as Element);
