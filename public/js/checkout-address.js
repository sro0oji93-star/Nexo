/* Lieferadresse: Photon-Autocomplete + OSRM-Fahrstrecke ab Restaurant (nur Checkout-Seite) */
(function () {
  var addrInput = document.getElementById('address');
  var cityInput = document.getElementById('city');
  var zipInput = document.getElementById('zip');
  var box = document.getElementById('addrSuggest');
  var latField = document.getElementById('delivery_lat');
  var lonField = document.getElementById('delivery_lon');
  var noteOk = document.getElementById('deliveryDistanceNote');
  var noteBlocked = document.getElementById('deliveryBlockedNote');
  if (!addrInput || !box) return;
  var cfg = window.deliveryConfig || { restaurant_lat: 53.295344, restaurant_lon: 10.391293, max_km: 12, phone: '04131 4006817' };

  // Zustand für den Submit-Check in cart.js
  window.DeliveryCheck = { lat: null, lon: null, km: null, fee: null, min: null, free: null, blocked: false };

  // NEXO Lieferservice-Zonen (vom Server via checkout.ejs, sonst Fallback)
  window.DeliveryZones = window.DeliveryZones || [
    { to: 3, fee: 1.00, min: 10.00, free: 20.00 },
    { to: 6, fee: 2.00, min: 15.00, free: 25.00 },
    { to: 9, fee: 3.00, min: 20.00, free: 30.00 },
    { to: 12, fee: 3.50, min: 25.00, free: 0 },
    { to: 15, fee: 4.50, min: 30.00, free: 0 }
  ];
  var maxZoneKm = window.DeliveryZones.length ? window.DeliveryZones[window.DeliveryZones.length - 1].to : 15;

  function findZone(km) {
    for (var i = 0; i < window.DeliveryZones.length; i++) {
      if (km <= window.DeliveryZones[i].to + 1e-9) return window.DeliveryZones[i];
    }
    return null;
  }

  function fmtKm(km) { return km.toFixed(1).replace('.', ',') + ' km'; }
  function fmtEur(v) { return v.toFixed(2).replace('.', ',') + ' €'; }

  // Bestellübersicht neu berechnen, damit der Zonenzuschlag sofort sichtbar wird
  function refreshSummary() {
    try {
      if (window.Cart && typeof window.Cart.renderCheckoutSummary === 'function') window.Cart.renderCheckoutSummary();
    } catch (e) { /* ignore */ }
  }

  function showOk(km) {
    if (!noteOk) return;
    var z = findZone(km);
    noteOk.style.display = 'block';
    noteOk.style.background = '#f0fdf4';
    noteOk.style.border = '1px solid #22c55e';
    noteOk.style.color = '#15803d';
    noteOk.textContent = 'Entfernung: ' + fmtKm(km) + ' Fahrstrecke – Lieferzuschlag ' + fmtEur(z.fee) + ', Mindestbestellwert ' + fmtEur(z.min) + (z.free > 0 ? ', ab ' + fmtEur(z.free) + ' kostenlose Lieferung.' : '.');
  }

  function showBlocked(km) {
    window.DeliveryCheck.blocked = true;
    if (noteOk) noteOk.style.display = 'none';
    if (!noteBlocked) return;
    noteBlocked.style.display = 'block';
    var kmTxt = km != null ? ' (' + fmtKm(km) + ' Fahrstrecke)' : '';
    noteBlocked.innerHTML = '';
    var t = document.createElement('div');
    t.textContent = 'Ihre Adresse liegt über ' + maxZoneKm + ' km Fahrstrecke von uns entfernt' + kmTxt + '. Bitte rufen Sie uns an und fragen Sie nach:';
    var t2 = document.createElement('div');
    t2.style.marginTop = '6px';
    t2.textContent = 'Bitte kontaktieren Sie uns – oder wählen Sie Abholung: ';
    var a = document.createElement('a');
    a.href = 'tel:' + String(cfg.phone).replace(/[^+\d]/g, '');
    a.style.color = '#b8001f';
    a.textContent = cfg.phone;
    t2.appendChild(a);
    noteBlocked.appendChild(t);
    noteBlocked.appendChild(t2);
  }

  function resetCheck() {
    window.DeliveryCheck.lat = null;
    window.DeliveryCheck.lon = null;
    window.DeliveryCheck.km = null;
    window.DeliveryCheck.fee = null;
    window.DeliveryCheck.min = null;
    window.DeliveryCheck.free = null;
    window.DeliveryCheck.blocked = false;
    if (latField) latField.value = '';
    if (lonField) lonField.value = '';
    if (noteOk) noteOk.style.display = 'none';
    if (noteBlocked) noteBlocked.style.display = 'none';
    refreshSummary();
  }

  function checkDistance(lat, lon) {
    window.DeliveryCheck.lat = lat;
    window.DeliveryCheck.lon = lon;
    if (latField) latField.value = lat;
    if (lonField) lonField.value = lon;
    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      cfg.restaurant_lon + ',' + cfg.restaurant_lat + ';' + lon + ',' + lat + '?overview=false';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.routes || !j.routes.length || typeof j.routes[0].distance !== 'number') return; // still -> Server entscheidet
      var km = j.routes[0].distance / 1000;
      window.DeliveryCheck.km = km;
      var zone = findZone(km);
      if (zone) {
        window.DeliveryCheck.fee = zone.fee;
        window.DeliveryCheck.min = zone.min;
        window.DeliveryCheck.free = zone.free;
        window.DeliveryCheck.blocked = false;
        showOk(km);
        refreshSummary();
      } else {
        showBlocked(km);
        refreshSummary();
      }
    }).catch(function () { /* still -> Server entscheidet */ });
  }

  function pickFeature(f) {
    var p = f.properties || {};
    var parts = [];
    if (p.street) parts.push(p.street + (p.housenumber ? ' ' + p.housenumber : ''));
    else if (p.name) parts.push(p.name);
    if (addrInput) addrInput.value = parts.join(' ');
    if (p.postcode && zipInput && !zipInput.value) zipInput.value = p.postcode;
    if ((p.city || p.town || p.village) && cityInput && !cityInput.value) cityInput.value = p.city || p.town || p.village;
    box.style.display = 'none';
    var coords = (f.geometry && f.geometry.coordinates) || null;
    if (coords && coords.length === 2) checkDistance(coords[1], coords[0]);
  }

  var timer = null;
  var lastQ = '';
  function search() {
    var q = (addrInput.value || '').trim();
    if (cityInput && cityInput.value.trim()) q += ' ' + cityInput.value.trim();
    if (zipInput && zipInput.value.trim()) q += ' ' + zipInput.value.trim();
    if (q.length < 3 || q === lastQ) { if (q.length < 3) box.style.display = 'none'; return; }
    lastQ = q;
    var url = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) +
      '&lat=' + cfg.restaurant_lat + '&lon=' + cfg.restaurant_lon + '&limit=6&lang=de';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var feats = (j && j.features) || [];
      feats = feats.filter(function (f) {
        var c = f.properties && f.properties.countrycode;
        return !c || c.toLowerCase() === 'de';
      }).slice(0, 6);
      if (!feats.length) { box.style.display = 'none'; return; }
      box.innerHTML = '';
      feats.forEach(function (f) {
        var p = f.properties || {};
        var main = (p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : (p.name || ''));
        var sub = [p.postcode, (p.city || p.town || p.village)].filter(Boolean).join(' ');
        var div = document.createElement('div');
        div.className = 'addr-suggest-item';
        var b = document.createElement('div');
        b.textContent = main;
        var s = document.createElement('small');
        s.textContent = sub;
        div.appendChild(b);
        div.appendChild(s);
        div.addEventListener('mousedown', function (e) { e.preventDefault(); pickFeature(f); });
        box.appendChild(div);
      });
      box.style.display = 'block';
    }).catch(function () { box.style.display = 'none'; });
  }

  ['address', 'city', 'zip'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function () {
      if (id === 'address') {
        resetCheck();
        if (timer) clearTimeout(timer);
        timer = setTimeout(search, 350);
      } else {
        lastQ = '';
      }
    });
    el.addEventListener('blur', function () { setTimeout(function () { box.style.display = 'none'; }, 200); });
    el.addEventListener('focus', function () { if (id === 'address' && box.children.length) box.style.display = 'block'; });
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') box.style.display = 'none'; });
})();
