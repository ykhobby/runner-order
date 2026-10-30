/* Cookieless visit and action counts with GoatCounter (goatcounter.com). Off until config.js has a goatcounterCode.
   Events carry only fixed names and public kit names, never anything a person typed. */
(function (root) {
  'use strict';
  const code = String((root.RunnerNotesConfig || {}).goatcounterCode || '').trim().toLowerCase();
  const queue = [];
  const ready = () => root.goatcounter && typeof root.goatcounter.count === 'function';
  function flush() {
    while (ready() && queue.length) root.goatcounter.count(queue.shift());
  }
  function send(hit) {
    if (!code) return;
    queue.push(hit);
    flush();
  }
  const api = {
    enabled: !!code,
    // A named action, e.g. event('pdf-export', 'By Section · 1 page').
    event(name, title) { send({ path: name, title: title || name, event: true }); },
    // Community pages live behind #/ addresses, which GoatCounter can't see on its own.
    page(path) { send({ path, title: root.document.title }); }
  };
  root.RunnerAnalytics = api;
  if (!/^[a-z0-9-]{2,50}$/.test(code)) { api.enabled = false; return; }

  // GoatCounter's own script reads these settings; it skips localhost, so testing locally isn't counted.
  root.goatcounter = { no_onload: false, allow_local: false };
  const script = root.document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  script.addEventListener('load', () => {
    // Retry briefly: count.js defines goatcounter.count just after it loads.
    let tries = 0;
    const wait = setInterval(() => { flush(); if (ready() || ++tries > 20) clearInterval(wait); }, 100);
  });
  root.document.head.append(script);
})(globalThis);
