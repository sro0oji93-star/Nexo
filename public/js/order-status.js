// Kunden-Tracking: aktive Bestellungen (Homepage-Widget) + Live-Status per SSE.
// Dateiname bewusst neutral (Adblocker filtern "tracking.js").
// - KEIN Polling: genau EIN EventSource, nur solange Tracking-Token gespeichert sind.
// - Banner sofort aus gespeicherten Token malen, Stream korrigiert danach live.
// - Einträge verschwinden bei finalem Status (zugestellt/geliefert/storniert)
//   oder automatisch nach 24h. localStorage = gerätegebunden, überlebt Reloads.
(function () {
  var LS_KEY = 'nexo_track_orders';
  var STREAM_URL = '/verfolgung/stream?tokens=';
  // Bait-Aufträge o.ä. verschwinden von selbst: Einträge älter als 24h werden
  // beim Laden verworfen (ohne ts = Altbestand -> sofort fällig).
  var MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var es = null;

  function load() {
    try {
      var arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      if (!Array.isArray(arr)) return [];
      var now = Date.now();
      var kept = arr.filter(function (o) { return o && o.n && o.t && o.ts && (now - o.ts) < MAX_AGE_MS; });
      if (kept.length !== arr.length) save(kept);
      return kept;
    } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function add(orderNumber, token) {
    var list = load();
    if (!list.some(function (o) { return o.n === orderNumber; })) {
      list.push({ n: orderNumber, t: token, ts: Date.now() });
      save(list);
    }
    render([]);
    connect();
  }

  function remove(orderNumber) {
    save(load().filter(function (o) { return o.n !== orderNumber; }));
  }

  function paint(items) {
    var box = document.getElementById('nexo-active-orders');
    if (!box) return;
    var active = items.filter(function (o) { return o.active; });
    if (!active.length) {
      box.style.display = 'none';
      box.innerHTML = '';
      if (es) { try { es.close(); } catch (e) {} es = null; }
      return;
    }
    box.style.display = 'block';
    var word = active.length === 1 ? 'aktive Bestellung' : 'aktive Bestellungen';
    var html = '<div style="max-width:1200px;margin:14px auto 0;padding:0 20px">'
      + '<a href="/verfolgung/' + encodeURIComponent(active[0].order_number) + '?t=' + encodeURIComponent(active[0].token) + '"'
      + ' style="display:flex;align-items:center;gap:10px;justify-content:center;background:#15803d;color:#fff;font-weight:bold;padding:12px 18px;border-radius:12px;text-decoration:none;font-size:15px;box-shadow:0 2px 10px rgba(0,0,0,.25)">'
      + '🧾 ' + active.length + ' ' + word + ' – live verfolgen</a></div>';
    box.innerHTML = html;
  }

  // items: [{ order_number, token, label, active }]
  function render(states) {
    var list = load();
    var byNum = {};
    (states || []).forEach(function (s) { byNum[s.order_number] = s; });
    var merged = [];
    var changed = false;
    list.forEach(function (o) {
      var s = byNum[o.n];
      if (s && !s.active) { changed = true; return; } // final -> Eintrag löschen
      merged.push({
        order_number: o.n,
        token: o.t,
        ts: o.ts,
        label: s ? s.label : '',
        active: s ? s.active : true // noch unbekannt -> vorerst aktiv zeigen
      });
    });
    if (changed) save(merged.map(function (m) { return { n: m.order_number, t: m.token, ts: m.ts }; }));
    paint(merged);
  }

  function connect() {
    // Sofort malen (gespeicherte Token), Stream bestätigt/korrigiert danach.
    // So erscheint das Banner auch bei langsamem Stream sofort nach dem Laden.
    render([]);
    var list = load();
    if (!list.length) return;
    if (es) return; // genau EIN Stream (kein Reconnect-Loop, kein Polling)
    try {
      es = new EventSource(STREAM_URL + encodeURIComponent(list.map(function (o) { return o.t; }).join(',')));
    } catch (e) { es = null; return; }
    var states = {};
    es.addEventListener('status', function (ev) {
      var o;
      try { o = JSON.parse(ev.data); } catch (e) { return; }
      if (!o || !o.order_number) return;
      states[o.order_number] = o;
      render(Object.keys(states).map(function (k) { return states[k]; }));
    });
    // Absichtlich KEIN Fetch auf 'error': EventSource verbindet sich selbst neu (retry),
    // der Server sendet den Startzustand bei jedem (Re-)Connect erneut.
  }

  window.NexoTracking = { add: add, all: load };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }
})();
