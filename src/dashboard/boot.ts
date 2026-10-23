import { startRouter } from './router/router.ts';
import { dashboardConfig } from './runtime/config.ts';

const { boot, pages } = dashboardConfig();
for (const url of boot) await import(url);
await startRouter(pages, document.getElementById('app') as Element);
window.dispatchEvent(new CustomEvent('ohne-booted'));
