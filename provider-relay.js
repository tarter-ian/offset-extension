// Runs in the service's tab, in the extension's own world.
// Passes the counts from the page to the background worker.
(function () {
  if (window.__offsetRelay) return;
  window.__offsetRelay = true;
  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var m = event.data;
    if (!m || m.source !== 'offset-provider') return;
    if (m.type === 'done' || m.type === 'idle' || m.type === 'progress') chrome.runtime.sendMessage({ type: m.type, data: m.data });
  });
})();
