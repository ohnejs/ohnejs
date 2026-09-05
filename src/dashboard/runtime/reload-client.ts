const source = new EventSource('/m/dashboard/reload');
let opened = 0;

source.addEventListener('message', () => location.reload());
// A reconnect means the dashboard child restarted, and with it the page manifest may have changed.
source.addEventListener('open', () => {
  if (opened++ > 0) location.reload();
});
