import { dashboardConfig } from './config.ts';
import { startRouter } from './router.ts';

void startRouter(dashboardConfig().pages, document.getElementById('app') as Element);
