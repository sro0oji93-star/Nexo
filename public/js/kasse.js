// Theken-Kasse: Touch-Warenkorb. Baut Item-Objekte EXAKT wie die Kunden-Kasse
// (cart.js), damit die serverseitige Prüfung/Bepreisung (order-pricing.js) greift.
// Kein localStorage, keine Checkout-Seite, kein Polling – POST nur beim Abschicken.
(function () {
  var MENUE_PRICE = 4.00;
  var MENUE_DRINKS = ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'];
  var BOWL_SAUCE_PRICE = 0.80;

  var items = [];
  var fee = 0;
  var discountCode = null;
  var discountValue = 0;
  var discountKind = null; // 'code' | 'manual' | null

  function fmt(n) { return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' €'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) {
    var t = document.getElementById('kasseToast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.display = 'none'; }, 2600);
  }

  function descOf(it) {
    var parts = [];
    if (it.size && it.size.label) parts.push(it.size.label);
    (it.extras || []).forEach(function (e) { parts.push(e.name); });
    if (it.menue && it.menue.drink && it.menue.drink !== true) parts.push('Menü mit ' + it.menue.drink);
    if (it.menue && it.menue.drink === true) parts.push('Menü');
    if (it.sauce) parts.push('Sauce: ' + it.sauce);
    if (it.sauces) parts.push('Saucen: ' + it.sauces.join(', '));
    if (it.chocos) parts.push(it.chocos.join(' + '));
    if (it.deal) parts.push('Deal');
    if (it.box) parts.push('Box');
    if (it.pasta) parts.push('Nudeln');
    return parts.join(' · ');
  }

  function totals() {
    var sum = 0;
    items.forEach(function (it) { sum += parseFloat(it.price) * parseInt(it.qty, 10); });
    return { sub: sum, total: Math.max(0, sum + fee - discountValue) };
  }

  function render() {
    var box = document.getElementById('kasseLines');
    var t = totals();
    if (!items.length && !fee) {
      box.innerHTML = '<p style="color:#999;font-size:14px">Noch keine Positionen.</p>';
    } else {
      var html = '';
      items.forEach(function (it, idx) {
        var d = descOf(it);
        html += '<div class="kasse-line"><div class="nm"><strong>' + it.qty + 'x ' + it.name + '</strong>'
          + (d ? '<small>' + d + '</small>' : '')
          + '</div><div class="kasse-qty"><button type="button" data-kq="-1" data-ki="' + idx + '">−</button>'
          + '<span>' + it.qty + '</span>'
          + '<button type="button" data-kq="1" data-ki="' + idx + '">+</button></div>'
          + '<strong>' + fmt(parseFloat(it.price) * parseInt(it.qty, 10)) + '</strong>'
          + '<button type="button" class="kasse-rm" data-kr="' + idx + '" title="Entfernen">×</button></div>';
      });
      if (fee > 0) html += '<div class="kasse-line"><div class="nm"><strong>Lieferkosten</strong></div><strong>' + fmt(fee) + '</strong></div>';
      box.innerHTML = html;
    }
    var dl = document.getElementById('kasseDiscLine');
    if (dl) {
      dl.innerHTML = (discountValue > 0 && discountKind)
        ? '<div class="kasse-line"><div class="nm"><strong>Rabatt' + (discountKind === 'code' && discountCode ? ' ' + esc(discountCode) : '') + '</strong></div><strong>-' + fmt(discountValue) + '</strong><button type="button" class="kasse-rm" data-kdisc-rm="1" title="Rabatt entfernen">×</button></div>'
        : '';
    }
    document.getElementById('kasseTotal').textContent = fmt(t.total);
  }

  function pushItem(o) {
    o.qty = 1;
    items.push(o);
    render();
  }

  function collect(btn) {
    var id = btn.getAttribute('data-id');
    var name = btn.getAttribute('data-name');
    var scope = btn.closest('.kasse-opts') || document;
    function q(sel) { return scope.querySelector(sel) || document.querySelector(sel); }
    function qa(sel) { var r = scope.querySelectorAll(sel); return r.length ? r : document.querySelectorAll(sel); }
    function checked(sel) {
      var list = qa(sel);
      for (var i = 0; i < list.length; i++) if (list[i].checked) return list[i];
      return null;
    }
    var pickupOnly = btn.getAttribute('data-pickup-only') === '1';

    if (btn.getAttribute('data-has-sizes')) {
      var radio = checked('input[name="size_' + id + '"]');
      if (!radio) { toast('Bitte Größe wählen'); return; }
      var size = { label: radio.getAttribute('data-label'), price: parseFloat(radio.value) };
      var extras = [];
      var exBox = q('[data-extras-for="' + id + '"]');
      if (exBox) {
        var cbs = exBox.querySelectorAll('input[type="checkbox"]:checked');
        for (var ci = 0; ci < cbs.length; ci++) {
          var nm = cbs[ci].getAttribute('data-extra-name');
          var pr = parseFloat(cbs[ci].getAttribute('data-extra-price'));
          if (nm && !isNaN(pr)) extras.push({ name: nm, price: parseFloat(pr.toFixed(2)) });
        }
      }
      var unit = size.price;
      extras.forEach(function (e) { unit += e.price; });
      var bowlSauces = [];
      var bwBox = q('[data-bowlsauces-for="' + id + '"]');
      if (bwBox) {
        var bcs = bwBox.querySelectorAll('input[type="checkbox"]:checked');
        for (var bi = 0; bi < bcs.length; bi++) bowlSauces.push(bcs[bi].getAttribute('data-bowl-sauce'));
      }
      if (bowlSauces.length > 1) unit += BOWL_SAUCE_PRICE * (bowlSauces.length - 1);
      unit = parseFloat(unit.toFixed(2));
      var chocoSel = [];
      var chBox = q('[data-chocobox-for="' + id + '"]');
      if (chBox) {
        var ccs = chBox.querySelectorAll('input[type="checkbox"]:checked');
        for (var cj = 0; cj < ccs.length; cj++) chocoSel.push(ccs[cj].getAttribute('data-choco'));
        if (chocoSel.length !== 2) { toast('Bitte 2 Schoko-Sorten wählen'); return; }
      }
      pushItem({ id: id, name: name, price: unit, size: size, extras: extras, pickupOnly: pickupOnly, menue: null, sauce: null, sauces: bowlSauces.length ? bowlSauces : null, box: null, chocos: chocoSel.length ? chocoSel : null, deal: null, pasta: null, note: '' });
    } else if (btn.getAttribute('data-has-menue')) {
      var drink = scope.querySelector('.menue-box input[type="radio"]:checked');
      if (drink) {
        var msize = { label: drink.getAttribute('data-label'), price: parseFloat(drink.value) };
        pushItem({ id: id, name: name, price: msize.price, size: msize, extras: [], pickupOnly: pickupOnly, menue: { drink: true }, sauce: null, sauces: null, box: null, chocos: null, deal: null, pasta: null, note: '' });
      } else {
        pushItem({ id: id, name: name, price: parseFloat(btn.getAttribute('data-price')), size: null, extras: [], pickupOnly: pickupOnly, menue: null, sauce: null, sauces: null, box: null, chocos: null, deal: null, pasta: null, note: '' });
      }
    } else if (btn.getAttribute('data-has-snacks-menue')) {
      var sradio = checked('input[name="size_' + id + '"]');
      if (!sradio) { toast('Bitte Größe wählen'); return; }
      var ssize = { label: sradio.getAttribute('data-label'), price: parseFloat(sradio.value) };
      var sunit = ssize.price;
      var smenue = null;
      var sbox = scope.querySelector('.snacks-menue input.menue-check');
      if (sbox && sbox.checked) {
        var sdrink = scope.querySelector('.snacks-menue input[type="radio"]:checked');
        if (!sdrink || MENUE_DRINKS.indexOf(sdrink.getAttribute('data-drink')) === -1) { toast('Bitte Softdrink wählen'); return; }
        smenue = { drink: sdrink.getAttribute('data-drink') };
        sunit = parseFloat((sunit + MENUE_PRICE).toFixed(2));
      }
      pushItem({ id: id, name: name, price: sunit, size: ssize, extras: [], pickupOnly: pickupOnly, menue: smenue, sauce: null, sauces: null, box: null, chocos: null, deal: null, pasta: null, note: '' });
    } else if (btn.getAttribute('data-has-sauce')) {
      var tsize = null;
      var tsradio = checked('input[name="size_' + id + '"]');
      if (tsradio) tsize = { label: tsradio.getAttribute('data-label'), price: parseFloat(tsradio.value) };
      else if (scope.querySelector('input[name="size_' + id + '"]')) { toast('Bitte Größe wählen'); return; }
      var tsauceEl = scope.querySelector('.free-sauce input[type="radio"]:checked');
      if (!tsauceEl) { toast('Bitte Sauce wählen'); return; }
      var tunit = tsize ? tsize.price : parseFloat(btn.getAttribute('data-price'));
      pushItem({ id: id, name: name, price: tunit, size: tsize, extras: [], pickupOnly: pickupOnly, menue: null, sauce: tsauceEl.getAttribute('data-sauce'), sauces: null, box: null, chocos: null, deal: null, pasta: null, note: '' });
    } else if (btn.getAttribute('data-has-choco')) {
      var cbox2 = scope.querySelector('.choco-box');
      if (!cbox2) { toast('Bitte 2 Schoko-Sorten wählen'); return; }
      var csel = [];
      var ccs2 = cbox2.querySelectorAll('input[type="checkbox"]:checked');
      for (var x = 0; x < ccs2.length; x++) csel.push(ccs2[x].getAttribute('data-choco'));
      if (csel.length !== 2) { toast('Bitte 2 Schoko-Sorten wählen'); return; }
      pushItem({ id: id, name: name, price: parseFloat(btn.getAttribute('data-price')), size: null, extras: [], pickupOnly: pickupOnly, menue: null, sauce: null, sauces: null, box: null, chocos: csel, deal: null, pasta: null, note: '' });
    } else if (btn.getAttribute('data-has-deal')) {
      var dbox = scope.querySelector('.deal-choices[data-deal-for="' + id + '"]');
      if (!dbox) { toast('Bitte Deal konfigurieren'); return; }
      var dealSlug = btn.getAttribute('data-deal-slug') || 'nexo-mittag-deal';
      var bEl = dbox.querySelector('input[data-deal-basis]:checked');
      if (!bEl) { toast('Bitte Basis wählen'); return; }
      var deal = { slug: dealSlug, choices: { basis: bEl.value } };
      if (bEl.value.indexOf('Pizza') === 0) {
        var tops = [];
        var tcs = dbox.querySelectorAll('input[data-deal-topping]:checked');
        for (var ti = 0; ti < tcs.length; ti++) tops.push(tcs[ti].value);
        if (tops.length > 3) { toast('Maximal 3 Beläge'); return; }
        deal.choices.belaege = tops;
      } else {
        var cr = dbox.querySelector('input[data-deal-croque]:checked');
        if (!cr) { toast('Bitte Croque-Sorte wählen'); return; }
        deal.choices.croque = cr.value;
      }
      var dr = dbox.querySelector('input[data-deal-drink]:checked');
      if (!dr) { toast('Bitte Getränk wählen'); return; }
      deal.choices.drink = dr.value;
      pushItem({ id: id, name: name, price: parseFloat(btn.getAttribute('data-price')), size: null, extras: [], pickupOnly: pickupOnly, menue: null, sauce: null, sauces: null, box: null, chocos: null, deal: deal, pasta: null, note: '' });
    } else if (btn.getAttribute('data-has-pasta')) {
      var pbox = scope.querySelector('.pasta-box[data-pasta-for="' + id + '"]');
      if (!pbox) { toast('Bitte Nudelsorte wählen'); return; }
      var pt = pbox.querySelector('input[data-pasta-type]:checked');
      if (!pt) { toast('Bitte Nudelsorte wählen'); return; }
      var pasta = { type: pt.value };
      if (pbox.getAttribute('data-needs-sauce')) {
        var ps = pbox.querySelector('input[data-pasta-sauce]:checked');
        if (!ps) { toast('Bitte Sauce wählen'); return; }
        pasta.sauce = ps.value;
      }
      pushItem({ id: id, name: name, price: parseFloat(btn.getAttribute('data-price')), size: null, extras: [], pickupOnly: pickupOnly, menue: null, sauce: null, sauces: null, box: null, chocos: null, deal: null, pasta: pasta, note: '' });
    } else if (btn.getAttribute('data-has-box')) {
      var bbox = scope.querySelector('.box-choices[data-box-for="' + id + '"]');
      if (!bbox) { toast('Bitte Box konfigurieren'); return; }
      var bboxSlug = btn.getAttribute('data-box-slug') || bbox.getAttribute('data-box-slug');
      var box = {};
      var boxOk = true;
      var radioGroups = {};
      var rcs = bbox.querySelectorAll('input[type="radio"]:checked');
      for (var ri = 0; ri < rcs.length; ri++) radioGroups[rcs[ri].getAttribute('data-box-group')] = rcs[ri].getAttribute('data-box-value');
      var allRadios = {};
      var ars = bbox.querySelectorAll('input[type="radio"]');
      for (var ai = 0; ai < ars.length; ai++) allRadios[ars[ai].getAttribute('data-box-group')] = true;
      Object.keys(allRadios).forEach(function (gk) {
        if (radioGroups[gk] === undefined) boxOk = false;
        else box[gk] = radioGroups[gk];
      });
      var ccs3 = bbox.querySelectorAll('input[type="checkbox"]:checked');
      for (var q3 = 0; q3 < ccs3.length; q3++) {
        var gk3 = ccs3[q3].getAttribute('data-box-group');
        if (!box[gk3]) box[gk3] = [];
        box[gk3].push(ccs3[q3].getAttribute('data-box-value'));
      }
      if (!boxOk) { toast('Bitte Box konfigurieren'); return; }
      var needMsg = null;
      var seen = {};
      var mcs = bbox.querySelectorAll('input[type="checkbox"][data-max]');
      for (var mi = 0; mi < mcs.length; mi++) {
        var gk = mcs[mi].getAttribute('data-box-group');
        if (seen[gk]) continue;
        seen[gk] = true;
        var gmax = parseInt(mcs[mi].getAttribute('data-max')) || 0;
        var gcnt = bbox.querySelectorAll('input[type="checkbox"][data-box-group="' + gk + '"]:checked').length;
        if (gcnt !== gmax) needMsg = 'Bitte ' + gmax + '× wählen (noch ' + (gmax - gcnt) + ')';
      }
      if (needMsg) { toast(needMsg); return; }
      pushItem({ id: id, name: name, price: parseFloat(btn.getAttribute('data-price')), size: null, extras: [], pickupOnly: pickupOnly, menue: null, sauce: null, sauces: null, box: { slug: bboxSlug, choices: box }, chocos: null, deal: null, pasta: null, note: '' });
    } else {
      pushItem({ id: id, name: name, price: parseFloat(btn.getAttribute('data-price')), size: null, extras: [], pickupOnly: pickupOnly, menue: null, sauce: null, sauces: null, box: null, chocos: null, deal: null, pasta: null, note: '' });
    }
  }

  // Rabatt: Code (serverseitig geprüft wie online) ODER direkter Betrag – nie beides.
  function applyDiscount() {
    var inp = document.getElementById('kasseDiscInput');
    var amtInp = document.getElementById('kasseDiscAmount');
    var code = inp && inp.value ? inp.value.trim().toUpperCase() : '';
    var amtRaw = amtInp && amtInp.value ? String(amtInp.value).trim().replace(',', '.') : '';
    if (code) {
      if (amtInp) amtInp.value = '';
      var t = totals();
      fetch('/bestellung/rabatt-pruefen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.KASSE_CSRF || '' },
        body: JSON.stringify({ code: code, subtotal: t.sub })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.valid) {
            discountCode = null;
            discountValue = 0;
            discountKind = null;
            render();
            toast(j.message || 'Rabattcode ungültig');
            return;
          }
          discountCode = code;
          discountValue = parseFloat(j.value) || 0;
          discountKind = 'code';
          render();
          toast(j.message || 'Rabatt angewendet');
        })
        .catch(function () { toast('Netzwerkfehler'); });
      return;
    }
    if (amtRaw) {
      var v = Math.round(parseFloat(amtRaw) * 100) / 100;
      if (!isFinite(v) || v <= 0) { toast('Bitte gültigen Betrag eingeben (z.B. 2,00)'); return; }
      discountCode = null;
      discountValue = v;
      discountKind = 'manual';
      if (inp) inp.value = '';
      render();
      toast('Rabatt angewendet');
      return;
    }
    toast('Bitte Rabattcode oder Betrag eingeben');
  }

  function submit() {
    if (!items.length) { toast('Bon ist leer'); return; }
    var btn = document.getElementById('kasseSubmit');
    if (btn) btn.disabled = true;
    fetch('/admin/kasse/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': window.KASSE_CSRF || '' },
      body: JSON.stringify({ items: items, fee: fee, discount_code: discountKind === 'code' ? discountCode : null, discount_value: discountKind === 'manual' ? discountValue : null })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (btn) btn.disabled = false;
        if (!j.success) { toast(j.message || 'Fehler'); return; }
        // Druck läuft über das bestehende Auto-Print-System (Theke: genau 1 Kopie).
        // Manueller Nachdruck bei Bedarf über den Bon-Link (ohne Autoprint).
        var last = document.getElementById('kasseLast');
        if (last) {
          last.textContent = '';
          var s = document.createElement('span');
          s.textContent = 'Bestellung ' + j.orderNumber + ' (' + fmt(j.total) + ') gespeichert. ';
          last.appendChild(s);
          if (j.id) {
            var a = document.createElement('a');
            a.href = '/admin/bestellungen/' + encodeURIComponent(j.id) + '/bon';
            a.target = '_blank';
            a.textContent = 'Bon drucken';
            last.appendChild(a);
          }
        }
        items = [];
        fee = 0;
        discountCode = null;
        discountValue = 0;
        discountKind = null;
        var di = document.getElementById('kasseDiscInput');
        if (di) di.value = '';
        var da = document.getElementById('kasseDiscAmount');
        if (da) da.value = '';
        paintFees();
        render();
        toast('Bestellung ' + j.orderNumber + ' gespeichert');
      })
      .catch(function () {
        if (btn) btn.disabled = false;
        toast('Netzwerkfehler');
      });
  }

  function paintFees() {
    var btns = document.querySelectorAll('#kasseFees .kasse-fee');
    for (var i = 0; i < btns.length; i++) {
      var v = parseFloat(btns[i].getAttribute('data-fee')) || 0;
      if (v === fee) btns[i].classList.add('active');
      else btns[i].classList.remove('active');
    }
  }

  // Burger-Menü: zweiter Klick auf dieselbe Auswahl hebt sie wieder auf –
  // danach gilt wieder der normale Burgerpreis. Pro Menü-Box gemerkt (braucht
  // kein mousedown und funktioniert mit Maus, Touch und Tastatur gleich).
  // Nur Kasse-Datei, Kundenseite (cart.js bindDrinkToggle) unverändert.
  document.addEventListener('click', function (e) {
    var mlab = e.target && e.target.closest ? e.target.closest('.menue-box label') : null;
    var mr = mlab ? mlab.querySelector('input[type="radio"]') : null;
    // Nur Label-Klicks behandeln (Inputs sind display:none): der weitergeleitete
    // Input-Klick danach wird ignoriert, sonst würde er sofort wieder umschalten.
    if (mr && e.target !== mr) {
      var mbox = mr.closest('.menue-box');
      if (mbox && mbox._kasseMenue === mr) {
        if (e.cancelable) e.preventDefault();
        mr.checked = false;
        mbox._kasseMenue = null;
      } else if (mbox) {
        mbox._kasseMenue = mr;
      }
    }
    var cat = e.target.closest ? e.target.closest('.kasse-cat') : null;
    if (cat) {
      var slug = cat.getAttribute('data-cat');
      document.querySelectorAll('.kasse-cat').forEach(function (c) { c.classList.remove('active'); });
      cat.classList.add('active');
      document.querySelectorAll('.kasse-catpage').forEach(function (p) {
        p.style.display = p.getAttribute('data-catpage') === slug ? '' : 'none';
      });
      document.getElementById('kasseFeePanel').style.display = slug === '__fee' ? '' : 'none';
      document.querySelectorAll('.kasse-opts.open').forEach(function (o) { o.classList.remove('open'); });
      document.querySelectorAll('.kasse-prod.selected').forEach(function (b) { b.classList.remove('selected'); });
      return;
    }
    var fb = e.target.closest ? e.target.closest('#kasseFees .kasse-fee') : null;
    if (fb) {
      fee = parseFloat(fb.getAttribute('data-fee')) || 0;
      paintFees();
      render();
      return;
    }
    // Manueller Betrag (Komma erlaubt): ersetzt die aktuelle Auswahl, addiert nie.
    var feeAdd = e.target.closest ? e.target.closest('#kasseFeeAdd') : null;
    if (feeAdd) {
      var inp = document.getElementById('kasseFeeInput');
      var raw = inp && inp.value ? String(inp.value).trim().replace(',', '.') : '';
      var v = parseFloat(raw);
      if (!isFinite(v) || v < 0) { toast('Bitte gültigen Betrag eingeben (z.B. 1,80)'); return; }
      fee = Math.round(v * 100) / 100;
      if (inp) inp.value = '';
      paintFees();
      render();
      return;
    }
    var prod = e.target.closest ? e.target.closest('.kasse-prod') : null;
    if (prod && !prod.disabled) {
      var pid = prod.getAttribute('data-pid');
      var was = prod.classList.contains('selected');
      document.querySelectorAll('.kasse-opts.open').forEach(function (o) { o.classList.remove('open'); });
      document.querySelectorAll('.kasse-prod.selected').forEach(function (b) { b.classList.remove('selected'); });
      if (!was) {
        prod.classList.add('selected');
        var panel = document.querySelector('.kasse-opts[data-opts-for="' + pid + '"]');
        if (panel) {
          panel.classList.add('open');
          panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      return;
    }
    var add = e.target.closest ? e.target.closest('.kasse-add') : null;
    if (add) { collect(add); return; }
    var q = e.target.closest ? e.target.closest('[data-kq]') : null;
    if (q) {
      var idx = parseInt(q.getAttribute('data-ki'), 10);
      var d = parseInt(q.getAttribute('data-kq'), 10);
      if (items[idx]) {
        items[idx].qty = Math.max(1, Math.min(20, (parseInt(items[idx].qty, 10) || 1) + d));
        render();
      }
      return;
    }
    var rm = e.target.closest ? e.target.closest('[data-kr]') : null;
    if (rm) {
      items.splice(parseInt(rm.getAttribute('data-kr'), 10), 1);
      render();
      return;
    }
    if (e.target.closest && e.target.closest('#kasseDiscApply')) { applyDiscount(); return; }
    var drmr = e.target.closest ? e.target.closest('[data-kdisc-rm]') : null;
    if (drmr) {
      discountCode = null;
      discountValue = 0;
      discountKind = null;
      var di2 = document.getElementById('kasseDiscInput');
      if (di2) di2.value = '';
      var da2 = document.getElementById('kasseDiscAmount');
      if (da2) da2.value = '';
      render();
      return;
    }
    if (e.target.closest && e.target.closest('#kasseClear')) {
      items = [];
      fee = 0;
      discountCode = null;
      discountValue = 0;
      discountKind = null;
      var di3 = document.getElementById('kasseDiscInput');
      if (di3) di3.value = '';
      var da3 = document.getElementById('kasseDiscAmount');
      if (da3) da3.value = '';
      paintFees();
      render();
      return;
    }
    if (e.target.closest && e.target.closest('#kasseSubmit')) { submit(); return; }
  });

  render();
})();
