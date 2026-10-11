// Runs on Offset's own pages only (see "matches" in manifest.json).
// Lets the page ask the extension to measure services, and hands the answers back.
//
// Page -> extension:  window.postMessage({ source: 'offset-site', type: 'ping' })
//                     window.postMessage({ source: 'offset-site', type: 'measure-all', requestId, services? })
//                       every service at once in background tabs; signed-out ones come back as an error
//                     window.postMessage({ source: 'offset-site', type: 'measure', service, requestId })
//                       one service in a front tab, so the person can sign in
// Extension -> page:  { source: 'offset-extension', type: 'ready', version }
//                     { source: 'offset-extension', type: 'started', requestId, services, needsPermission }
//                       needsPermission lists services the person is now being asked to allow
//                     { source: 'offset-extension', type: 'counting', service, requestId }
//                       the person allowed this service and its count has begun
//                     { source: 'offset-extension', type: 'usage' | 'error', service, requestId, usage?, error? }
//                       error is 'signed-out', 'denied', 'closed', 'timeout' or 'unavailable'
(function () {
  var toPage = function (message) {
    window.postMessage(Object.assign({ source: 'offset-extension' }, message), location.origin);
  };
  var ready = function () {
    toPage({ type: 'ready', version: chrome.runtime.getManifest().version });
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var m = event.data;
    if (!m || m.source !== 'offset-site') return;
    if (m.type === 'ping') {
      ready();
    } else if (m.type === 'measure' || m.type === 'measure-all') {
      var request = { type: m.type, service: m.service, services: m.services, requestId: m.requestId };
      chrome.runtime.sendMessage(request, function (res) {
        var failed = chrome.runtime.lastError || !res || !res.ok;
        toPage({
          type: failed ? 'error' : 'started',
          error: failed ? (res && res.error) || 'unavailable' : undefined,
          service: m.service,
          services: res && res.services,
          needsPermission: res && res.needsPermission,
          requestId: m.requestId,
        });
      });
    }
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === 'usage' || message.type === 'error' || message.type === 'counting') toPage(message);
  });

  ready();
})();
