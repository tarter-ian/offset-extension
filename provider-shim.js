// Runs in the service's page, before the counting script.
// The counting scripts were written for Reclaim's client and report through
// window.Reclaim. Here that goes to the extension instead; no proof is made.
(function () {
  if (window.__offsetShim) return;
  window.__offsetShim = true;
  var send = function (type, data) {
    window.postMessage({ source: 'offset-provider', type: type, data: data }, location.origin);
  };
  // The counts and the finish signal go out as one message, so they cannot arrive out of order.
  var usage = null;
  window.Reclaim = {
    updatePublicData: function (data) {
      usage = data;
    },
    requestClaim: function () {
      send('done', usage);
      var banner = document.getElementById('offset-usage-banner');
      if (banner) banner.textContent = 'Done. This tab will close.';
      return Promise.resolve();
    },
  };

  // Each counting script starts only once it sees a signed-in session. If none
  // has started after a while, say so, so a background tab is not left waiting.
  var STATES = ['__offsetChatgptUsage', '__offsetClaudeUsage', '__offsetYoutubeActivity', '__offsetGeminiActivity'];
  setTimeout(function () {
    var running = STATES.some(function (name) {
      var s = window[name];
      return s && (s.started || s.done);
    });
    if (!running) send('idle');
  }, 15000);
})();
