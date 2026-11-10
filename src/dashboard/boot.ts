import { startRouter } from './router/router.ts';
import { dashboardConfig } from './runtime/config.ts';
import { settleSessionLanguage } from './runtime/session.ts';

const { boot, pages } = dashboardConfig();
for (const url of boot) await import(url);
try {
  settleSessionLanguage();
} catch (error) {
  console.error(error);
}
await startRouter(pages, document.getElementById('app') as Element);
window.dispatchEvent(new CustomEvent('ohne-booted'));
