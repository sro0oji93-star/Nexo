// Neue-Bestellungen-Wächter: Sound + Auto-Bon-Druck (TM-T88V, 80mm)
// Funktioniert mit Render-Server + lokalem Drucker-PC: diese Seite läuft auf dem
// PC, an dem der Bondrucker hängt. Live-Betrieb über SSE (/admin/api/orders-stream);
// /admin/api/neue-bestellungen dient nur als Catch-up bei (Re-)Connect – kein Polling.
(function () {
  var LS_LAST = 'nexo_last_order_id';
  var LS_SOUND = 'nexo_sound_on';
  var audioCtx = null;
  var ringing = false;
  var printQueue = [];
  var printing = false;
  var BON_COPIES = 2; // jede neue Bestellung 2x drucken

  function lastId() { return parseInt(localStorage.getItem(LS_LAST) || '0', 10) || 0; }
  function setLastId(v) { localStorage.setItem(LS_LAST, String(v)); }
  function soundOn() { return localStorage.getItem(LS_SOUND) !== 'off'; }

  // Laute Klingel per WebAudio (keine MP3-Datei nötig), 3x hintereinander
  function beep(freq, t0, dur) {
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + dur);
  }
  function ring() {
    if (!soundOn()) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      for (var r = 0; r < 4; r++) {
        beep(880, t + r * 0.7, 0.3);
        beep(660, t + r * 0.7 + 0.32, 0.3);
      }
    } catch (e) { console.warn('Audio blockiert:', e); }
  }
  function ringLoop(order) {
    // Klingelt alle 5s weiter, bis der Nutzer bestätigt (Browser blockt sonst Dauer-Ton)
    ring();
    showBanner(order);
    ringing = true;
  }

  function showBanner(order) {
    if (document.getElementById('nexo-neworder-banner')) return;
    var d = document.createElement('div');
    d.id = 'nexo-neworder-banner';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;padding:14px 20px;font-size:17px;font-weight:bold;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.4);cursor:pointer;font-family:sans-serif';
    d.innerHTML = '🔔 NEUE BESTELLUNG ' + order.order_number + ' – ' + Number(order.total).toFixed(2) + ' € — klicken zum Stoppen + Ansehen';
    d.onclick = function () { stopRing(); location.href = '/admin/bestellungen/' + order.id; };
    document.body.appendChild(d);
  }
  function stopRing() {
    ringing = false;
    var b = document.getElementById('nexo-neworder-banner');
    if (b) b.remove();
  }

  // Bon im versteckten Iframe drucken (Drucker = Standarddrucker des PCs = TM-T88V)
  function printBon(order) {
    printQueue.push(order);
    pumpQueue();
  }
  function pumpQueue() {
    if (printing || !printQueue.length) return;
    printing = true;
    var order = printQueue.shift();
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      printing = false;
      try { f.remove(); } catch (e) {}
      pumpQueue();
    }
    var f = document.createElement('iframe');
    // Off-screen aber gerendert: visibility:hidden / 0x0 wird von Chrome teils nicht gedruckt
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:80mm;height:600px;border:0;background:#fff';
    f.src = '/admin/bestellungen/' + order.id + '/bon';
    // Aufräumen erst nach Druckdialog (afterprint) – sonst wird der Druck abgebrochen
    var fallback = setTimeout(finish, 60000);
    // Theken-Bestellungen (Kasse): genau 1 Kopie; Online-Bestellungen: 2 Kopien (unverändert).
    var copiesLeft = (order && order.notes === 'Theken-Bestellung') ? 1 : BON_COPIES;
    f.onload = function () {
      try {
        var w = f.contentWindow;
        var doc = w.document;
        var go = function () {
          setTimeout(function () {
            try { w.focus(); w.print(); } catch (e) { console.warn('print err', e); }
            fetch('/admin/api/bestellungen/' + order.id + '/gedruckt', { method: 'POST', credentials: 'same-origin' }).catch(function(){});
          }, 600);
        };
        // afterprint -> 2. Kopie drucken, danach aufräumen
        try { w.onafterprint = function () {
          clearTimeout(fallback);
          if (--copiesLeft > 0) { fallback = setTimeout(finish, 60000); go(); }
          else finish();
        }; } catch (e) {}
        if (doc.readyState === 'complete') go();
        else { w.onload = go; setTimeout(go, 1500); }
      } catch (e) { console.warn('print err', e); clearTimeout(fallback); finish(); }
    };
    f.onerror = function () { clearTimeout(fallback); finish(); };
    document.body.appendChild(f);
  }

  // Bereits gesehene Bestell-IDs (schützt vor Doppel-Ton/-Druck, wenn SSE-Catch-up
  // des Servers und unser Client-Catch-up dieselbe Bestellung liefern).
  var seenIds = {};
  function isSeen(id) { return !!seenIds[id]; }
  function markSeen(id) { seenIds[id] = 1; }

  // Listen-Aktualisierung entprellt bündeln (SSE liefert Bestellungen einzeln,
  // früher kamen sie als Batch aus einem Poll) – weiterhin max. 1 HTML-Fetch / 6s.
  var refreshTimer = null;
  var pendingRefreshIds = [];
  function scheduleListRefresh(id) {
    pendingRefreshIds.push(id);
    if (refreshTimer) return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      var ids = pendingRefreshIds;
      pendingRefreshIds = [];
      refreshLists(ids);
    }, 6000);
  }

  function handleNewOrder(o) {
    if (!o || !o.id) return;
    if (isSeen(o.id)) return;
    markSeen(o.id);
    ringLoop(o);
    printBon(o);
    if (o.id > lastId()) setLastId(o.id);
    // Liste live aktualisieren (ohne Seiten-Reload, damit der Druckdialog nicht abbricht)
    scheduleListRefresh(o.id);
  }

  // Catch-up NUR bei (wieder-)hergestellter SSE-Verbindung – niemals auf 'error',
  // damit eine Störung keine Request-Schleife erzeugt (EventSource verbindet
  // sich selbstständig neu per Server-`retry: 3000`). Schutz gegen Mehrfachlauf:
  // In-Flight-Sperre + Mindestabstand zwischen zwei Catch-ups.
  var catchUpInFlight = false;
  var lastCatchUpAt = 0;
  var CATCHUP_MIN_GAP_MS = 5000;
  async function catchUp() {
    var now = Date.now();
    if (catchUpInFlight) return;
    if (now - lastCatchUpAt < CATCHUP_MIN_GAP_MS) return;
    catchUpInFlight = true;
    lastCatchUpAt = now;
    // Zeigerstand zu Beginn merken: Erster Catch-up überhaupt initialisiert nur
    // den Zeiger und druckt NIEMALS alte Bestellungen (gleiche Semantik wie früher).
    var firstInit = !localStorage.getItem(LS_LAST);
    try {
      var r = await fetch('/admin/api/neue-bestellungen?last_id=' + lastId(), { credentials: 'same-origin' });
      if (!r.ok) return;
      var j = await r.json();
      if (!j.success) return;
      if (firstInit) {
        if (j.orders) j.orders.forEach(function (o) { if (o && o.id) markSeen(o.id); });
        setLastId(j.max_id || 0);
        return;
      }
      if (j.orders && j.orders.length) {
        j.orders.forEach(function (o) { handleNewOrder(o); });
        if (j.max_id && j.max_id > lastId()) setLastId(j.max_id);
      } else if (j.max_id && j.max_id > lastId()) {
        setLastId(j.max_id);
      }
    } catch (e) { /* offline -> SSE-Reconnect übernimmt */ }
    finally { catchUpInFlight = false; }
  }

  function connectSSE() {
    var es;
    try {
      es = new EventSource('/admin/api/orders-stream?last_id=' + lastId());
    } catch (e) { return; }
    // Listener ZUERST registrieren, damit keine Bestellung verloren geht,
    // erst danach läuft der Catch-up (auf 'open').
    es.addEventListener('order', function (ev) {
      var o;
      try { o = JSON.parse(ev.data); } catch (e) { return; }
      if (!o || !o.id) return;
      if (isSeen(o.id)) return;
      markSeen(o.id);
      // Erster Kontakt überhaupt: nur Zeiger initialisieren, NIEMALS alte drucken.
      if (!localStorage.getItem(LS_LAST)) {
        if (o.id > lastId()) setLastId(o.id);
        return;
      }
      ringLoop(o);
      printBon(o);
      if (o.id > lastId()) setLastId(o.id);
      scheduleListRefresh(o.id);
    });
    es.onopen = function () {
      // Verbindung steht (Erstaufbau oder Reconnect): Lücke per Catch-up schließen.
      catchUp();
    };
    es.onerror = function () {
      // Absichtlich KEIN Fetch hier: EventSource verbindet sich automatisch neu
      // (Server-`retry`). Der Catch-up läuft beim nächsten 'open'.
    };
  }

  // Bestellliste still aktualisieren: Seite neu laden (als HTML) und nur
  // Tabellen-Body + Tages-Badge ersetzen. Kein location.reload -> Druck läuft weiter.
  async function refreshLists(newIds) {
    try {
      // Nur wenn Filter "alle"/"neu" (sonst wäre die neue Bestellung eh unsichtbar)
      var st = new URLSearchParams(location.search).get('status') || 'alle';
      var onOrders = location.pathname.indexOf('/admin/bestellungen') === 0;
      var onDash = location.pathname === '/admin' || location.pathname === '/admin/';
      if (onOrders && st !== 'alle' && st !== 'neu') return;
      if (!onOrders && !onDash) return;
      var r = await fetch(location.pathname + location.search, { credentials: 'same-origin' });
      if (!r.ok) return;
      var t = await r.text();
      var doc = new DOMParser().parseFromString(t, 'text/html');
      var newTbody = doc.querySelector('.admin-table tbody');
      var curTbody = document.querySelector('.admin-table tbody');
      if (newTbody && curTbody) {
        curTbody.innerHTML = newTbody.innerHTML;
        // Neue Zeilen grün markieren
        (newIds || []).forEach(function (id) {
          var a = curTbody.querySelector('a[href="/admin/bestellungen/' + id + '"]');
          if (a && a.closest('tr')) {
            a.closest('tr').style.background = '#dcfce7';
            a.closest('tr').style.transition = 'background 2s';
            setTimeout(function () { if (a.closest('tr')) a.closest('tr').style.background = ''; }, 30000);
          }
        });
      }
      var newBadge = doc.querySelector('.section-header-row .badge');
      var curBadge = document.querySelector('.section-header-row .badge');
      if (newBadge && curBadge) curBadge.textContent = newBadge.textContent;
    } catch (e) { /* still weiter pollen */ }
  }

  function addControls() {
    if (document.getElementById('nexo-sound-toggle')) return;
    var b = document.createElement('button');
    b.id = 'nexo-sound-toggle';
    b.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:99998;padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-weight:bold;font-size:14px;font-family:sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)';
    function paint() {
      b.textContent = soundOn() ? '🔔 Ton: AN (klicken=aus)' : '🔕 Ton: AUS (klicken=an)';
      b.style.background = soundOn() ? '#15803d' : '#6b7280';
      b.style.color = '#fff';
    }
    b.onclick = function () {
      localStorage.setItem(LS_SOUND, soundOn() ? 'off' : 'on');
      if (soundOn()) { try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); ring(); } catch (e) {} stopRing(); }
      paint();
    };
    paint();
    document.body.appendChild(b);
  }

  addControls();
  connectSSE();
})();
