/* Cart Module */
var Cart = (function() {
  var items = [];
  var discount = { code: null, value: 0 };
  var orderType = 'lieferung';
  var settings = window.restaurantSettings || { delivery_fee: 4.50, free_delivery_from: 40.00 };
  // Snacks-Menü: Aufpreis + erlaubte Softdrinks (Server prüft alles erneut – hier nur Anzeige)
  var MENUE_PRICE = 4.00;
  var MENUE_DRINKS = ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'];
  // Bowls-Saucen: 1× inklusive, jede weitere +0,80 €
  var BOWL_SAUCE_PRICE = 0.80;

  function makeKey(id, size, extras, menue, sauce, sauces, box, chocos, deal, pasta) {
    var base = size && size.label ? id + '-' + size.label : String(id);
    if (extras && extras.length) {
      var names = extras.map(function(e) { return e.name; }).sort();
      base += '|x:' + names.join('+');
    }
    if (menue && menue.drink) base += '|m:' + menue.drink;
    if (sauce) base += '|s:' + sauce;
    if (sauces && sauces.length) base += '|b:' + sauces.slice().sort().join('+');
    if (box) base += '|box:' + stableBoxKey(box);
    if (chocos && chocos.length) base += '|c:' + chocos.slice().sort().join('+');
    if (deal && deal.choices) base += '|deal:' + stableDealKey(deal);
    if (pasta && pasta.type) base += '|pasta:' + pasta.type + (pasta.sauce ? '+' + pasta.sauce : '');
    return base;
  }

  function stableDealKey(deal) {
    var c = deal.choices || {};
    return 'slug=' + deal.slug + ';' + Object.keys(c).sort().map(function(k) {
      var v = c[k];
      return k + '=' + (Array.isArray(v) ? v.slice().sort().join('+') : String(v));
    }).join(';');
  }

  function stableBoxKey(box) {
    return Object.keys(box).sort().map(function(k) {
      var v = box[k];
      return k + '=' + (Array.isArray(v) ? v.slice().sort().join('+') : String(v));
    }).join(';');
  }

  function migrateKeys() {
    items.forEach(function(i) {
      i._key = makeKey(i.id, i.size, i.extras, i.menue, i.sauce, i.sauces, i.box, i.chocos, i.deal, i.pasta);
    });
  }

  function init() {
    load();
    renderCartBadge();
    bindAddToCart();
    bindBoxMax();
    bindDrinkToggle();
    bindBurgerMenue();
    bindLiveAbButtons();
    applyDealWindows();
    bindPhoneSanitizer();
    // Kasse: Extra entfernen + Notiz pro Position (delegiert, einmalig)
    document.addEventListener('click', function(e) {
      var x = e.target && e.target.closest ? e.target.closest('.co-extra-x') : null;
      if (x) removeExtra(x.getAttribute('data-key'), x.getAttribute('data-extra'));
    });
    document.addEventListener('input', function(e) {
      var n = e.target && e.target.closest ? e.target.closest('.co-note') : null;
      if (n) {
        setItemNote(n.getAttribute('data-key'), n.value);
        var wrap0 = n.closest('.co-note-wrap');
        if (wrap0) wrap0.classList.toggle('has-note', String(n.value || '').trim().length > 0);
      }
    });
    // Anmerkung: ein Element – Fokus = ausklappen an Ort und Stelle, Blur = einklappen
    document.addEventListener('focusin', function(e) {
      var n = e.target && e.target.closest ? e.target.closest('.co-note-single') : null;
      if (n) n.classList.add('open');
    });
    document.addEventListener('focusout', function(e) {
      var n = e.target && e.target.closest ? e.target.closest('.co-note-single') : null;
      if (n) n.classList.remove('open');
    });
    if (document.getElementById('cartList')) renderCartPage();
    if (document.getElementById('checkoutItems')) { bindOrderType(); bindTimeMode(); applyPickupRules(); renderCheckoutSummary(); }
  }

  function load() {
    try {
      var data = localStorage.getItem('feinCart');
      if (data) items = JSON.parse(data);
      items.forEach(function(i) {
        if (!i.extras) i.extras = [];
        if (typeof i.pickupOnly === 'undefined') i.pickupOnly = false;
        if (!i.menue || !i.menue.drink) delete i.menue;
        if (typeof i.sauce !== 'string' || !i.sauce) delete i.sauce;
        if (!Array.isArray(i.sauces)) delete i.sauces;
        if (!i.box || typeof i.box !== 'object') delete i.box;
        if (!Array.isArray(i.chocos)) delete i.chocos;
        if (!i.deal || typeof i.deal !== 'object' || !i.deal.choices) delete i.deal;
        if (!i.pasta || typeof i.pasta !== 'object' || !i.pasta.type) delete i.pasta;
        i._key = makeKey(i.id, i.size, i.extras, i.menue, i.sauce, i.sauces, i.box, i.chocos, i.deal, i.pasta);
      });
      var disc = localStorage.getItem('feinDiscount');
      if (disc) discount = JSON.parse(disc);
      var ot = localStorage.getItem('feinOrderType');
      if (ot === 'abholung' || ot === 'lieferung') orderType = ot;
    } catch(e) { items = []; }
  }

  function save() {
    localStorage.setItem('feinCart', JSON.stringify(items));
    localStorage.setItem('feinDiscount', JSON.stringify(discount));
    localStorage.setItem('feinOrderType', orderType);
  }

  function getOrderType() { return orderType; }

  function setOrderType(t) {
    if (t !== 'abholung' && t !== 'lieferung') return;
    orderType = t;
    save();
    if (document.getElementById('cartList')) renderCartPage();
    if (document.getElementById('checkoutItems')) renderCheckoutSummary();
  }

  function needsPickupOnly() {
    return items.some(function(i) { return !!i.pickupOnly; });
  }

  function addItem(id, name, price, qty, size, extras, pickupOnly, menue, sauce, sauces, box, chocos, deal, pasta) {
    qty = qty || 1;
    extras = extras || [];
    if (!menue || !menue.drink) menue = null;
    if (typeof sauce !== 'string' || !sauce) sauce = null;
    if (!Array.isArray(sauces) || !sauces.length) sauces = null;
    if (!box || typeof box !== 'object') box = null;
    if (!Array.isArray(chocos) || !chocos.length) chocos = null;
    if (!deal || typeof deal !== 'object' || !deal.choices) deal = null;
    if (!pasta || typeof pasta !== 'object' || !pasta.type) pasta = null;
    var key = makeKey(id, size, extras, menue, sauce, sauces, box, chocos, deal, pasta);
    var existing = items.find(function(i) { return i._key === key; });
    if (existing) {
      existing.qty += qty;
      if (pickupOnly) existing.pickupOnly = true;
    } else {
      items.push({ _key: key, id: id, name: name, price: parseFloat(price), qty: qty, size: size || null, extras: extras, pickupOnly: !!pickupOnly, menue: menue, sauce: sauce, sauces: sauces, box: box, chocos: chocos, deal: deal, pasta: pasta });
    }
    save();
    renderCartBadge();
    showToast('"' + name + '" zum Warenkorb hinzugefügt!');
    if (document.getElementById('cartList')) renderCartPage();
    if (document.getElementById('checkoutItems')) renderCheckoutSummary();
  }

  function removeItem(key) {
    items = items.filter(function(i) { return i._key !== key; });
    save();
    renderCartBadge();
    if (document.getElementById('cartList')) renderCartPage();
    if (document.getElementById('checkoutItems')) renderCheckoutSummary();
  }

  function updateQty(key, qty) {
    var item = items.find(function(i) { return i._key === key; });
    if (item) {
      item.qty = Math.max(1, Math.min(20, qty));
      save();
    if (document.getElementById('cartList')) renderCartPage();
    if (document.getElementById('checkoutItems')) renderCheckoutSummary();
  }
  }

  function getSubtotal() {
    return items.reduce(function(sum, i) { return sum + (i.price * i.qty); }, 0);
  }

  function getDeliveryFee(subtotal) {
    if (orderType === 'abholung') return 0;
    // Zonenpreis aus der Adressprüfung (OSRM-Fahrstrecke), sonst alte Pauschale als Fallback
    if (window.DeliveryCheck && window.DeliveryCheck.fee != null && isFinite(window.DeliveryCheck.fee)) {
      var zfree = parseFloat(window.DeliveryCheck.free) || 0;
      if (zfree > 0 && subtotal >= zfree - 1e-9) return 0;
      return parseFloat(window.DeliveryCheck.fee);
    }
    var fee = parseFloat(settings.delivery_fee) || 4.50;
    var freeFrom = parseFloat(settings.free_delivery_from) || 40.00;
    return subtotal >= freeFrom ? 0 : fee;
  }

  // Mindestbestellwert der ermittelten Zone (null = unbekannt -> keine Prüfung)
  function getZoneMin() {
    if (orderType !== 'lieferung') return null;
    if (window.DeliveryCheck && window.DeliveryCheck.min != null && isFinite(window.DeliveryCheck.min)) {
      return parseFloat(window.DeliveryCheck.min);
    }
    return null;
  }

  function getTotal() {
    var sub = getSubtotal();
    var fee = getDeliveryFee(sub);
    var disc = discount.value;
    return Math.max(0, sub + fee - disc);
  }

  function applyDiscount(code) {
    var discData = window.discounts || [];
    var found = discData.find(function(d) {
      return d.code === code && d.active == 1;
    });
    if (!found) {
      discount.code = null;
      discount.value = 0;
      save();
      return { valid: false, message: 'Rabattcode ungültig' };
    }
    var sub = getSubtotal();
    if (parseFloat(found.min_order) > 0 && sub < parseFloat(found.min_order)) {
      return { valid: false, message: 'Mindestbestellwert ' + parseFloat(found.min_order).toFixed(2) + ' € nicht erreicht' };
    }
    var val = found.type === 'prozent' ? (sub * parseFloat(found.value) / 100) : parseFloat(found.value);
    discount.code = code;
    discount.value = parseFloat(val.toFixed(2));
    save();
    return { valid: true, message: 'Rabatt von ' + discount.value.toFixed(2) + ' € angewendet!' };
  }

  function clearDiscount() {
    discount.code = null;
    discount.value = 0;
    save();
  }

  function renderCartBadge() {
    var badge = document.getElementById('cartBadgeMad');
    if (!badge) badge = document.getElementById('cartBadge');
    if (badge) {
      var count = items.reduce(function(s, i) { return s + i.qty; }, 0);
      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  function showToast(msg) {
    var toast = document.getElementById('cartToast');
    var toastMsg = document.getElementById('cartToastMsg');
    if (toast && toastMsg) {
      toastMsg.textContent = msg;
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 2500);
    }
  }

  // Tageszeit-Angebote: Button außerhalb des Bestellfensters deaktivieren + Hinweis zeigen
  // (Serverseitig wird beim Checkout erneut streng geprüft)
  function applyDealWindows() {
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    var btns = document.querySelectorAll('.add-to-cart[data-deal-from]');
    for (var bi = 0; bi < btns.length; bi++) {
      (function(btn) {
        var from = parseInt(String(btn.getAttribute('data-deal-from')).replace(/[^\d]/g, ''), 10);
        var to = parseInt(String(btn.getAttribute('data-deal-to')).replace(/[^\d]/g, ''), 10);
        if (isFinite(from) && isFinite(to) && mins >= from && mins < to) return;
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        if (!btn.parentElement || btn.parentElement.querySelector('.deal-hint')) return;
        var hint = document.createElement('div');
        hint.className = 'deal-hint';
        hint.style.cssText = 'margin-top:6px;font-size:12px;color:var(--primary);font-weight:700';
        hint.textContent = btn.getAttribute('data-deal-hint') || 'Aktuell nicht verfügbar';
        btn.insertAdjacentElement('afterend', hint);
      })(btns[bi]);
    }
  }

  // Wunschtermin-Umschalter an der Kasse (Sofort vs. Wunschtermin)
  function minPreorderMin() {
    var c = window.deliveryConfig || {};
    var key = (typeof orderType !== 'undefined' && orderType === 'abholung')
      ? 'min_preorder_min_pickup' : 'min_preorder_min_delivery';
    var n = parseInt(c[key], 10);
    if (!isFinite(n)) n = (key === 'min_preorder_min_pickup' ? 15 : 45);
    return Math.max(15, Math.min(240, n));
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  // Wunschtermin je Bestellart (verschachtelt): zwei sichtbare Gruppen, ein gemeinsamer Zustand
  var wishState = { mode: 'asap', value: '' };
  function timeGroupEls(sfx) {
    return {
      radios: document.querySelectorAll('input[name="timeMode' + sfx + '"]'),
      input: document.getElementById('wish_time_' + sfx.toLowerCase()),
      hint: document.getElementById('wishHint' + sfx),
      block: document.querySelector('.time-sub[data-for="' + (sfx === 'L' ? 'lieferung' : 'abholung') + '"]')
    };
  }
  function paintTimeGroups() {
    ['L', 'A'].forEach(function(sfx) {
      var g = timeGroupEls(sfx);
      var active = (sfx === 'L' ? 'lieferung' : 'abholung') === orderType;
      if (g.block) g.block.style.display = active ? '' : 'none';
      g.radios.forEach(function(r) { r.checked = (r.value === wishState.mode); });
      if (g.input) {
        if (g.input.value !== wishState.value) g.input.value = wishState.value;
        var row = g.input.closest('.wish-row');
        if (row) row.style.display = wishState.mode === 'wish' ? '' : 'none';
        g.input.min = toLocalInput(new Date(Date.now() + minPreorderMin() * 60000));
      }
      if (g.hint) g.hint.textContent = 'Mindestens ' + minPreorderMin() + ' Minuten im Voraus, täglich 12:00–00:00 Uhr.';
    });
  }
  function bindTimeMode() {
    if (!document.querySelector('input[name="timeModeL"]')) return;
    ['L', 'A'].forEach(function(sfx) {
      var g = timeGroupEls(sfx);
      g.radios.forEach(function(r) {
        r.addEventListener('change', function() {
          wishState.mode = this.value;
          paintTimeGroups();
        });
      });
      if (g.input) g.input.addEventListener('input', function() {
        wishState.value = this.value;
        paintTimeGroups();
      });
    });
    paintTimeGroups();
  }

  // Bestellart-Umschalter an der Kasse (Abholung blendet Lieferadresse aus)
  function bindOrderType() {
    var radios = document.querySelectorAll('input[name="orderType"]');
    if (!radios.length) return;
    radios.forEach(function(r) {
      if (r.value === orderType) r.checked = true;
      r.addEventListener('change', function() {
        if (needsPickupOnly() && this.value === 'lieferung') {
          applyPickupRules();
          return;
        }
        setOrderType(this.value);
        toggleAddress(this.value);
      });
    });
    toggleAddress(orderType);
  }

  function toggleAddress(t) {
    var isPickup = (t === 'abholung');
    var card = document.getElementById('addressCard');
    var payCard = document.getElementById('paymentCard');
    var addr = document.getElementById('address');
    var city = document.getElementById('city');
    var zip = document.getElementById('zip');
    if (card) card.style.display = isPickup ? 'none' : '';
    if (payCard) payCard.style.display = isPickup ? 'none' : '';
    [addr, city, zip].forEach(function(f) { if (f) f.required = !isPickup; });
    paintTimeGroups();
  }

  // Night Deal o.ä.: Bestellart auf Abholung zwingen
  function applyPickupRules() {
    var note = document.getElementById('pickupOnlyNote');
    var lieferRadio = document.querySelector('input[name="orderType"][value="lieferung"]');
    var abholRadio = document.querySelector('input[name="orderType"][value="abholung"]');
    if (needsPickupOnly()) {
      orderType = 'abholung';
      save();
      if (lieferRadio) lieferRadio.disabled = true;
      if (abholRadio) abholRadio.checked = true;
      if (note) note.style.display = 'block';
      toggleAddress('abholung');
    } else {
      if (lieferRadio) lieferRadio.disabled = false;
      if (note) note.style.display = 'none';
      var checked = document.querySelector('input[name="orderType"]:checked');
      toggleAddress(checked ? checked.value : orderType);
    }
  }

  // Telefonfeld: unzulässige Zeichen schon beim Tippen entfernen (Desktop-Schutz)
  function bindPhoneSanitizer() {
    var phoneField = document.getElementById('phone');
    if (!phoneField || phoneField.dataset.sanitized) return;
    phoneField.dataset.sanitized = '1';
    phoneField.addEventListener('input', function() {
      var clean = this.value.replace(/[^0-9+\s\-/().]/g, '');
      if (clean !== this.value) this.value = clean;
    });
  }

  // Menü-Getränke (Burger/Snacks): zweiter Klick auf dieselbe Auswahl hebt sie wieder auf
  function drinkRadioFromEvent(e) {
    var lab = e.target && e.target.closest ? e.target.closest('.menue-box label, .snacks-menue label') : null;
    if (!lab) return null;
    var r = lab.querySelector('input[type="radio"]');
    return r || null;
  }
  // Box-Auswahl: Checkbox-Maximum erzwingen (z.B. max. 3 Saucen, max. 2 Schoko)
  function bindBoxMax() {
    document.addEventListener('change', function(e) {
      var cb = e.target && e.target.matches && e.target.matches('.box-choices input[type="checkbox"]') ? e.target : null;
      if (!cb || !cb.checked) return;
      var max = parseInt(cb.getAttribute('data-max')) || 0;
      if (!max) return;
      var box = cb.closest('.box-choices');
      var group = cb.getAttribute('data-box-group');
      var sel = group
        ? 'input[type="checkbox"][data-box-group="' + group + '"]:checked'
        : 'input[type="checkbox"]:checked';
      var checked = box.querySelectorAll(sel);
      if (checked.length > max) {
        cb.checked = false;
        showToast('Maximal ' + max + '× wählbar');
      }
    });
  }

  function bindDrinkToggle() {
    var armed = null;
    document.addEventListener('mousedown', function(e) {
      var r = drinkRadioFromEvent(e);
      armed = (r && r.checked) ? r : null;
    });
    document.addEventListener('click', function(e) {
      var r = drinkRadioFromEvent(e);
      if (r && r === armed) {
        // Standard-Aktion (erneutes Aktivieren) verhindern, sonst wäre der Radio sofort wieder an
        if (e.cancelable) e.preventDefault();
        r.checked = false;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        // Detailseite: Preis-Anzeige zurück auf Grundpreis
        var dp = document.getElementById('detailPrice');
        if (dp) {
          var btn = document.querySelector('.add-to-cart[data-price]');
          if (btn) dp.textContent = parseFloat(btn.getAttribute('data-price')).toFixed(2) + ' €';
        }
      }
      armed = null;
    });
  }

  // Burger-Menü (alte Liste): nur Button-Preis live anzeigen, sonst nichts ändern.
  // Ohne Wahl = Grundpreis, mit Wahl = Menü-Preis. Detailseite-Preis wird mitgeführt.
  function fmtBurgerDE(n) { return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' €'; }
  function refreshBurgerButton(box) {
    if (!box) return;
    var scope = box.closest('.mad-spec-info') || box.closest('.content-element-2') || document;
    var btn = scope ? scope.querySelector('.add-to-cart[data-has-menue]') : null;
    if (!btn) return;
    var baseP = parseFloat(btn.getAttribute('data-price')) || 0;
    var sel = box.querySelector('input[type="radio"]:checked');
    var finalP = sel ? parseFloat(sel.value) : baseP;
    if (!isFinite(finalP)) finalP = baseP;
    var txt = 'In den Warenkorb · ' + fmtBurgerDE(finalP);
    var span = btn.querySelector('span');
    if (span) span.textContent = txt; else btn.textContent = txt;
    var dp = document.getElementById('detailPrice');
    if (dp && box.closest('.content-element-2')) dp.textContent = (sel ? '' : 'ab ') + fmtBurgerDE(finalP);
  }
  function bindBurgerMenue() {
    document.addEventListener('change', function(e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches('.menue-box input[type="radio"]')) return;
      var box = t.closest('.menue-box');
      refreshBurgerButton(box);
    });
    document.querySelectorAll('.menue-box').forEach(function(b) { refreshBurgerButton(b); });
  }

  // Live-Preis am Button NUR für variable Produkte (ab-Preis): Größe + Extras + Bowls + Snacks-Menü.
  // Fixpreis-Buttons (Box/Deal/Choco/Pasta/Sauce-ohne-Größe, Burger) bleiben unangetastet.
  // Design bleibt gleich – nur der Button-Text bekommt "· X,XX €".
  function liveBlockOfBtn(btn) {
    return btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || null;
  }
  function liveSizeRadios(block) {
    var out = [];
    var all = block.querySelectorAll('input[type="radio"][name^="size_"], input[type="radio"][name="detailSize"]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].closest('.menue-box')) continue; // Burger-Menü gehört zu refreshBurgerButton
      out.push(all[i]);
    }
    return out;
  }
  function liveIsVariable(block) {
    if (!block) return false;
    var vals = {};
    var n = 0;
    liveSizeRadios(block).forEach(function(r) { vals[String(r.value)] = true; n++; });
    if (n === 0) return false;
    if (Object.keys(vals).length > 1) return true; // mehrere Preise = ab-Preis
    // Gleicher Preis überall: nur variabel, wenn Extras/Bowls/Snacks-Menü den Total ändern können
    if (block.querySelector('[data-extras-for]')) return true;
    if (block.querySelector('[data-bowlsauces-for]')) return true;
    if (block.querySelector('.snacks-menue')) return true;
    return false;
  }
  function liveTotal(block, btn) {
    var total = 0;
    var checked = null;
    liveSizeRadios(block).forEach(function(r) { if (!checked && r.checked) checked = r; });
    if (checked) total += parseFloat(checked.value) || 0;
    else total += parseFloat(btn.getAttribute('data-price')) || 0;
    var exBox = block.querySelector('[data-extras-for]');
    if (exBox) {
      exBox.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb) {
        total += parseFloat(cb.getAttribute('data-extra-price')) || 0;
      });
    }
    var bwBox = block.querySelector('[data-bowlsauces-for]');
    if (bwBox) {
      var bn = bwBox.querySelectorAll('input[type="checkbox"]:checked').length;
      if (bn > 1) total += BOWL_SAUCE_PRICE * (bn - 1);
    }
    var snBox = block.querySelector('.snacks-menue input.menue-check');
    if (snBox && snBox.checked) total += MENUE_PRICE;
    return parseFloat(total.toFixed(2));
  }
  function liveFmt(n) { return (parseFloat(n) || 0).toFixed(2).replace('.', ',') + ' €'; }
  function refreshLiveBtn(btn) {
    var block = liveBlockOfBtn(btn);
    if (!block || !liveIsVariable(block)) return;
    var t = liveTotal(block, btn);
    var txt = 'In den Warenkorb · ' + liveFmt(t);
    var span = btn.querySelector('span');
    if (span) span.textContent = txt; else btn.textContent = txt;
    var dp = document.getElementById('detailPrice');
    if (dp && block.closest('.content-element-2')) dp.textContent = liveFmt(t);
  }
  function refreshLiveBlock(block) {
    if (!block) return;
    var btn = block.querySelector('.add-to-cart[data-has-sizes], .add-to-cart[data-has-snacks-menue], .add-to-cart[data-has-sauce]');
    if (btn) refreshLiveBtn(btn);
  }
  function bindLiveAbButtons() {
    document.addEventListener('change', function(e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('.size-picker input[type="radio"], .size-picker-detail input[type="radio"], [data-extras-for] input[type="checkbox"], [data-bowlsauces-for] input[type="checkbox"], .snacks-menue input')) {
        var block = t.closest('.mad-spec-info') || t.closest('.content-element-2');
        // pizza-extras.js schreibt data-extra-price erst danach – daher deferred lesen
        setTimeout(function() { refreshLiveBlock(block); }, 0);
      }
    });
    document.querySelectorAll('.add-to-cart[data-has-sizes], .add-to-cart[data-has-snacks-menue], .add-to-cart[data-has-sauce]').forEach(function(b) { refreshLiveBtn(b); });
  }

  function bindAddToCart() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.add-to-cart');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var name = btn.getAttribute('data-name');
      var hasSizes = btn.getAttribute('data-has-sizes');
      var hasMenue = btn.getAttribute('data-has-menue');
      var hasSnacksMenue = btn.getAttribute('data-has-snacks-menue');
      var hasSauce = btn.getAttribute('data-has-sauce');
      var hasChoco = btn.getAttribute('data-has-choco');
      var hasBox = btn.getAttribute('data-has-box');
      var boxSlug = btn.getAttribute('data-box-slug');
      var pickupOnly = btn.getAttribute('data-pickup-only') === '1';
      var qtyInput = document.getElementById('qtyInput');
      var qty = qtyInput ? parseInt(qtyInput.value) || 1 : 1;

      if (hasSizes) {
        var radio = document.querySelector('input[name="size_' + id + '"]:checked') || document.querySelector('input[name="detailSize"]:checked');
        if (!radio) { showToast('Bitte wählen Sie eine Größe'); return; }
        var size = {
          label: radio.getAttribute('data-label'),
          price: parseFloat(radio.value)
        };
        var extras = [];
        var extrasBox = document.querySelector('[data-extras-for="' + id + '"]');
        if (extrasBox) {
          var checked = extrasBox.querySelectorAll('input[type="checkbox"]:checked');
          for (var ci = 0; ci < checked.length; ci++) {
            var nm = checked[ci].getAttribute('data-extra-name');
            var pr = parseFloat(checked[ci].getAttribute('data-extra-price'));
            if (nm && !isNaN(pr)) extras.push({ name: nm, price: parseFloat(pr.toFixed(2)) });
          }
        }
        var unit = size.price;
        extras.forEach(function(e) { unit += e.price; });
        // Bowls-Saucen: 1× inklusive, jede weitere +0,80 €
        var bowlSauces = [];
        var bowlBox = document.querySelector('[data-bowlsauces-for="' + id + '"]');
        if (bowlBox) {
          var bchecked = bowlBox.querySelectorAll('input[type="checkbox"]:checked');
          for (var bi = 0; bi < bchecked.length; bi++) bowlSauces.push(bchecked[bi].getAttribute('data-bowl-sauce'));
        }
        if (bowlSauces.length > 1) unit += BOWL_SAUCE_PRICE * (bowlSauces.length - 1);
        unit = parseFloat(unit.toFixed(2));
        // Schoko-Box Dessert: genau 2 Pflicht (inklusive)
        var chocoSel = [];
        var chocoBox = document.querySelector('[data-chocobox-for="' + id + '"]');
        if (chocoBox) {
          chocoBox.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c) { chocoSel.push(c.getAttribute('data-choco')); });
          if (chocoSel.length !== 2) { showToast('Bitte 2 Schoko-Sorten wählen'); return; }
        }
        addItem(id, name, unit, qty, size, extras, pickupOnly, null, null, bowlSauces.length ? bowlSauces : null, null, chocoSel.length ? chocoSel : null);
      } else if (hasMenue) {
        // Optionales Menü: nur wenn ein Softdrink gewählt wurde, sonst Grundpreis
        var scope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var drink = scope ? scope.querySelector('.menue-box input[type="radio"]:checked') : null;
        if (drink) {
          var msize = { label: drink.getAttribute('data-label'), price: parseFloat(drink.value) };
          addItem(id, name, msize.price, qty, msize, [], pickupOnly);
        } else {
          var basePrice = btn.getAttribute('data-price');
          addItem(id, name, basePrice, qty, null, [], pickupOnly);
        }
      } else if (hasSnacksMenue) {
        // Snacks: Größe Pflicht, Menü (+4 € mit Softdrink) optional
        var sscope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var sradio = sscope.querySelector('input[name="size_' + id + '"]:checked') || sscope.querySelector('input[name="detailSize"]:checked');
        if (!sradio) { showToast('Bitte wählen Sie eine Größe'); return; }
        var ssize = { label: sradio.getAttribute('data-label'), price: parseFloat(sradio.value) };
        var sbox = sscope.querySelector('.snacks-menue input.menue-check');
        var smenue = null;
        var sunit = ssize.price;
        if (sbox && sbox.checked) {
          var sdrink = sscope.querySelector('.snacks-menue input[type="radio"]:checked');
          if (!sdrink || MENUE_DRINKS.indexOf(sdrink.getAttribute('data-drink')) === -1) { showToast('Bitte Softdrink wählen'); return; }
          smenue = { drink: sdrink.getAttribute('data-drink') };
          sunit = parseFloat((sunit + MENUE_PRICE).toFixed(2));
        }
        addItem(id, name, sunit, qty, ssize, [], pickupOnly, smenue);
      } else if (hasSauce) {
        // Gratis-Sauce (z.B. Pizza Brötchen): Größe falls vorhanden, Sauce Pflicht
        var tscope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var tsize = null;
        var tsradio = tscope.querySelector('input[name="size_' + id + '"]:checked') || tscope.querySelector('input[name="detailSize"]:checked');
        if (tsradio) {
          tsize = { label: tsradio.getAttribute('data-label'), price: parseFloat(tsradio.value) };
        } else if (tscope.querySelector('input[name="size_' + id + '"], input[name="detailSize"]')) {
          showToast('Bitte wählen Sie eine Größe'); return;
        }
        var tsauceEl = tscope.querySelector('.free-sauce input[type="radio"]:checked');
        if (!tsauceEl) { showToast('Bitte Sauce wählen'); return; }
        var tsauce = tsauceEl.getAttribute('data-sauce');
        var tunit = tsize ? tsize.price : parseFloat(btn.getAttribute('data-price'));
        addItem(id, name, tunit, qty, tsize, [], pickupOnly, null, tsauce);
      } else if (hasChoco) {
        // Schoko-Box Dessert: genau 2 Pflicht (inklusive)
        var cscope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var cbox = cscope ? cscope.querySelector('.choco-box') : null;
        if (!cbox) { showToast('Bitte 2 Schoko-Sorten wählen'); return; }
        var csel = [];
        cbox.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c) { csel.push(c.getAttribute('data-choco')); });
        if (csel.length !== 2) { showToast('Bitte 2 Schoko-Sorten wählen'); return; }
        var cunit = parseFloat(btn.getAttribute('data-price'));
        addItem(id, name, cunit, qty, null, [], pickupOnly, null, null, null, null, csel);
      } else if (btn.getAttribute('data-has-deal')) {
        // Mittag Deal: Basis + (Beläge | Croque) + Getränk aus .deal-choices lesen
        var dscope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var dbox = dscope ? dscope.querySelector('.deal-choices[data-deal-for="' + id + '"]') : null;
        if (!dbox) { showToast('Bitte Deal konfigurieren'); return; }
        var dealSlug = btn.getAttribute('data-deal-slug') || 'nexo-mittag-deal';
        var bEl = dbox.querySelector('input[data-deal-basis]:checked');
        if (!bEl) { showToast('Bitte Basis wählen (Pizza oder Baguette)'); return; }
        var isPizza = bEl.value.indexOf('Pizza') === 0;
        var deal = { slug: dealSlug, choices: { basis: bEl.value } };
        if (isPizza) {
          var tops = [];
          dbox.querySelectorAll('input[data-deal-topping]:checked').forEach(function(c) { tops.push(c.value); });
          if (tops.length > 3) { showToast('Maximal 3 Beläge'); return; }
          deal.choices.belaege = tops;
        } else {
          var cr = dbox.querySelector('input[data-deal-croque]:checked');
          if (!cr) { showToast('Bitte Croque-Sorte wählen'); return; }
          deal.choices.croque = cr.value;
        }
        var dr = dbox.querySelector('input[data-deal-drink]:checked');
        if (!dr) { showToast('Bitte Getränk 0,33 l wählen'); return; }
        deal.choices.drink = dr.value;
        var dunit = parseFloat(btn.getAttribute('data-price'));
        addItem(id, name, dunit, qty, null, [], pickupOnly, null, null, null, null, null, deal);
      } else if (btn.getAttribute('data-has-pasta')) {
        // Pasta: Nudelsorte (+ Sauce bei NEXO Wunsch) aus .pasta-box lesen
        var pscope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var pbox = pscope ? pscope.querySelector('.pasta-box[data-pasta-for="' + id + '"]') : null;
        if (!pbox) { showToast('Bitte Nudelsorte wählen'); return; }
        var pt = pbox.querySelector('input[data-pasta-type]:checked');
        if (!pt) { showToast('Bitte Nudelsorte wählen'); return; }
        var pasta = { type: pt.value };
        if (pbox.getAttribute('data-needs-sauce')) {
          var ps = pbox.querySelector('input[data-pasta-sauce]:checked');
          if (!ps) { showToast('Bitte Sauce wählen'); return; }
          pasta.sauce = ps.value;
        }
        var punit = parseFloat(btn.getAttribute('data-price'));
        addItem(id, name, punit, qty, null, [], pickupOnly, null, null, null, null, null, null, pasta);
      } else if (hasBox) {
        // NEXO Box: Konfiguration aus .box-choices lesen (Radios Pflicht, Checkboxen mit Max)
        var bscope = btn.closest('.mad-spec-info') || btn.closest('.content-element-2') || document;
        var bbox = bscope ? bscope.querySelector('.box-choices[data-box-for="' + id + '"]') : null;
        if (!bbox) { showToast('Bitte Box konfigurieren'); return; }
        var bboxSlug = btn.getAttribute('data-box-slug') || bbox.getAttribute('data-box-slug');
        var box = {};
        var boxOk = true;
        var radioGroups = {};
        bbox.querySelectorAll('input[type="radio"]:checked').forEach(function(r) {
          radioGroups[r.getAttribute('data-box-group')] = r.getAttribute('data-box-value');
        });
        // Pflicht-Radios: jede Radio-Gruppe braucht eine Auswahl
        var allRadios = {};
        bbox.querySelectorAll('input[type="radio"]').forEach(function(r) {
          allRadios[r.getAttribute('data-box-group')] = true;
        });
        Object.keys(allRadios).forEach(function(gk) {
          if (radioGroups[gk] === undefined) boxOk = false;
          else box[gk] = radioGroups[gk];
        });
        // Checkboxen: alle gewählten übernehmen (Max wird live begrenzt)
        bbox.querySelectorAll('input[type="checkbox"]:checked').forEach(function(c) {
          var gk = c.getAttribute('data-box-group');
          if (!box[gk]) box[gk] = [];
          box[gk].push(c.getAttribute('data-box-value'));
        });
        if (!boxOk) { showToast('Bitte Box konfigurieren'); return; }
        // Pflicht: Checkbox-Gruppen müssen vollständig sein (z.B. genau 3 Saucen)
        var BOX_GROUP_LABELS = { sauces: 'Saucen', snacks: 'Snacks', toppings: 'Zutaten', sorten: 'Sorten' };
        var seenBoxGroups = {};
        var needMsg = null;
        bbox.querySelectorAll('input[type="checkbox"][data-max]').forEach(function(c) {
          var gk = c.getAttribute('data-box-group');
          if (seenBoxGroups[gk]) return;
          seenBoxGroups[gk] = true;
          var gmax = parseInt(c.getAttribute('data-max')) || 0;
          var gcnt = bbox.querySelectorAll('input[type="checkbox"][data-box-group="' + gk + '"]:checked').length;
          if (gcnt !== gmax) needMsg = 'Bitte ' + gmax + '× ' + (BOX_GROUP_LABELS[gk] || gk) + ' wählen (noch ' + (gmax - gcnt) + ')';
        });
        if (needMsg) { showToast(needMsg); return; }
        var bunit = parseFloat(btn.getAttribute('data-price'));
        addItem(id, name, bunit, qty, null, [], pickupOnly, null, null, null, { slug: bboxSlug, choices: box });
      } else {
        var price = btn.getAttribute('data-price');
        addItem(id, name, price, qty, null, [], pickupOnly);
      }

      if (qtyInput) qtyInput.value = 1;
    });
  }

  // Box-Auswahl lesbar machen (Warenkorb/Kasse)
  var BOX_KEY_LABELS = { burger1: 'Burger 1', burger2: 'Burger 2', burger: 'Burger', pasta: 'Pasta', snacks: 'Snacks', pizzabroetchen: 'Pizza Brötchen', toppings: 'Pizza', sauces: 'Saucen', sorten: 'Sorten' };
  function boxLines(box) {
    if (!box || !box.choices) return [];
    return Object.keys(box.choices).sort().map(function(k) {
      var v = box.choices[k];
      var label = BOX_KEY_LABELS[k] || k;
      return label + ': ' + (Array.isArray(v) ? v.join(', ') : String(v));
    });
  }

  function formatEUR(amount) {
    return amount.toFixed(2).replace('.', ',') + ' €';
  }

  var DEAL_KEY_LABELS = { basis: 'Basis', belaege: 'Beläge', croque: 'Croque', drink: 'Getränk 0,33 l' };
  function pastaLines(pasta) {
    if (!pasta || !pasta.type) return [];
    var out = ['Nudeln: ' + pasta.type];
    if (pasta.sauce) out.push('Sauce: ' + pasta.sauce);
    return out;
  }
  function dealLines(deal) {
    if (!deal || !deal.choices) return [];
    return Object.keys(deal.choices).sort().map(function(k) {
      var v = deal.choices[k];
      var label = DEAL_KEY_LABELS[k] || k;
      return label + ': ' + (Array.isArray(v) ? (v.join(', ') || '–') : String(v));
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Deutsche Rufnummer prüfen: nur erlaubte Zeichen, 7–15 Ziffern, 0… oder +49…
  function isValidPhone(p) {
    if (p == null) return false;
    var s = String(p).trim();
    if (!/^[+\d\s(][\d\s\-/().]*$/.test(s)) return false;
    var digits = s.replace(/\D/g, '');
    if (digits.slice(0, 2) === '00') digits = digits.slice(2);
    if (digits.length < 7 || digits.length > 15) return false;
    return digits.charAt(0) === '0' || digits.slice(0, 2) === '49';
  }

  // Extra aus einer Position in der Kasse entfernen (Preis wird neu berechnet)
  function removeExtra(key, extraName) {
    var item = items.find(function(i) { return i._key === key; });
    if (!item || !item.extras) return;
    var removed = 0;
    item.extras = item.extras.filter(function(e) {
      if (e.name === extraName) { removed += parseFloat(e.price) || 0; return false; }
      return true;
    });
    item.price = parseFloat((item.price - removed).toFixed(2));
    var newKey = makeKey(item.id, item.size, item.extras);
    var other = null;
    for (var k = 0; k < items.length; k++) {
      if (items[k]._key === newKey && items[k] !== item) { other = items[k]; break; }
    }
    if (other) {
      other.qty = Math.max(1, Math.min(20, other.qty + item.qty));
      if (!other.note && item.note) other.note = item.note;
      items = items.filter(function(i) { return i !== item; });
    } else {
      item._key = newKey;
    }
    save();
    renderCartBadge();
    if (document.getElementById('cartList')) renderCartPage();
    if (document.getElementById('checkoutItems')) renderCheckoutSummary();
  }

  // Notiz pro Position (nur Kasse) – speichert ohne Neuzeichnen (Fokus bleibt)
  function setItemNote(key, text) {
    var item = items.find(function(i) { return i._key === key; });
    if (!item) return;
    text = String(text == null ? '' : text).slice(0, 200);
    if (text.trim()) item.note = text;
    else delete item.note;
    save();
  }

  function renderCartPage() {
    var list = document.getElementById('cartList');
    var empty = document.getElementById('cartEmpty');
    var summary = document.getElementById('cartSummary');
    if (!list || !empty || !summary) return;

    if (items.length === 0) {
      list.style.display = 'none';
      empty.style.display = 'block';
      summary.style.display = 'none';
      return;
    }
    list.style.display = 'block';
    empty.style.display = 'none';
    summary.style.display = 'block';

    var pickupBanner = needsPickupOnly()
      ? '<div style="margin-bottom:12px;padding:10px 14px;background:#241f0e;border:1px solid var(--primary);border-radius:10px;font-size:13px;color:var(--primary);font-weight:600">Hinweis: Der Night Deal ist nur für Abholer – an der Kasse ist nur Abholung möglich (ohne Liefergebühr).</div>'
      : '';

    list.innerHTML = pickupBanner + items.map(function(item) {
      var nameHtml = item.size ? escapeHtml(item.name) + ' <small>(' + escapeHtml(item.size.label) + ')</small>' : escapeHtml(item.name);
      if (item.menue && item.menue.drink) nameHtml += '<br><small style="color:#9c7c1a">+ Menü mit ' + escapeHtml(item.menue.drink) + '</small>';
      if (item.sauce) nameHtml += '<br><small style="color:#9c7c1a">+ Sauce: ' + escapeHtml(item.sauce) + '</small>';
      if (item.sauces && item.sauces.length) nameHtml += '<br><small style="color:#9c7c1a">+ Saucen: ' + escapeHtml(item.sauces.join(', ')) + '</small>';
      if (item.chocos && item.chocos.length) nameHtml += '<br><small style="color:#9c7c1a">+ Schoko: ' + escapeHtml(item.chocos.join(', ')) + '</small>';
      if (item.box) nameHtml += '<br><small style="color:#9c7c1a">' + escapeHtml(boxLines(item.box).join(' · ')) + '</small>';
      if (item.deal) nameHtml += '<br><small style="color:#9c7c1a">' + escapeHtml(dealLines(item.deal).join(' · ')) + '</small>';
      if (item.pasta) nameHtml += '<br><small style="color:#9c7c1a">' + escapeHtml(pastaLines(item.pasta).join(' · ')) + '</small>';
      var extrasHtml = '';
      if (item.extras && item.extras.length) {
        extrasHtml = '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">' + item.extras.map(function(e) {
          return '<span style="display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;border:1px solid #22c55e;color:#15803d;border-radius:20px;padding:2px 6px 2px 10px;font-size:12px;font-weight:600">+ ' + escapeHtml(e.name) + ' <button type="button" class="co-extra-x" data-key="' + escapeHtml(item._key) + '" data-extra="' + escapeHtml(e.name) + '" title="Extra entfernen" style="border:none;background:#16a34a;color:#fff;border-radius:50%;width:18px;height:18px;line-height:16px;font-size:12px;cursor:pointer;padding:0">×</button></span>';
        }).join('') + '</div>';
      }
      var noteVal = item.note ? escapeHtml(item.note) : '';
      var noteHtml = '<div class="co-note-wrap' + (item.note ? ' has-note' : '') + '">'
        + '<textarea class="co-note co-note-single" data-key="' + escapeHtml(item._key) + '" maxlength="200" rows="1" placeholder="✎ Anmerkung hinzufügen…">' + noteVal + '</textarea>'
        + '</div>';
      return '<div class="cart-item">' +
        '<div class="cart-item-image"><i class="fas fa-utensils"></i></div>' +
        '<div class="cart-item-info"><h4>' + nameHtml + '</h4>' + extrasHtml + '</div>' +
        '<div class="cart-item-qty">' +
          '<button onclick="Cart.updateQty(\'' + item._key + '\', ' + (item.qty - 1) + ')">−</button>' +
          '<span>' + item.qty + '</span>' +
          '<button onclick="Cart.updateQty(\'' + item._key + '\', ' + (item.qty + 1) + ')">+</button>' +
        '</div>' +
        '<div class="cart-item-total">' + formatEUR(item.price * item.qty) + '</div>' +
        '<button class="cart-item-remove" onclick="Cart.removeItem(\'' + item._key + '\')"><i class="fas fa-times"></i></button>' +
        noteHtml +
      '</div>';
    }).join('');

    updateSummary();
  }

  function updateSummary() {
    var sub = getSubtotal();
    var fee = getDeliveryFee(sub);
    var total = getTotal();

    document.getElementById('cartSubtotal').textContent = formatEUR(sub);
    var feeRow = document.getElementById('cartDeliveryRow');
    if (feeRow) feeRow.style.display = orderType === 'abholung' ? 'none' : '';
    document.getElementById('cartDelivery').textContent = fee === 0 ? 'Kostenfrei' : formatEUR(fee);
    document.getElementById('cartTotal').textContent = formatEUR(total);

    var discRow = document.getElementById('discountRow');
    var discEl = document.getElementById('cartDiscount');
    if (discount.value > 0 && discRow && discEl) {
      discRow.style.display = 'flex';
      discEl.textContent = '−' + formatEUR(discount.value);
    } else if (discRow) {
      discRow.style.display = 'none';
    }
  }

  function renderCheckoutSummary() {
    var container = document.getElementById('checkoutItems');
    if (!container) return;

    applyPickupRules();
    if (items.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">Warenkorb ist leer</p>';
      return;
    }

    container.innerHTML = items.map(function(item) {
      var nameHtml = item.size ? escapeHtml(item.name) + ' (' + escapeHtml(item.size.label) + ')' : escapeHtml(item.name);
      if (item.menue && item.menue.drink) nameHtml += ' + Menü mit ' + escapeHtml(item.menue.drink);
      if (item.sauce) nameHtml += ' + Sauce: ' + escapeHtml(item.sauce);
      if (item.sauces && item.sauces.length) nameHtml += ' + Saucen: ' + escapeHtml(item.sauces.join(', '));
      if (item.chocos && item.chocos.length) nameHtml += ' + Schoko: ' + escapeHtml(item.chocos.join(', '));
      if (item.box) nameHtml += ' (' + escapeHtml(boxLines(item.box).join(' · ')) + ')';
      if (item.deal) nameHtml += ' (' + escapeHtml(dealLines(item.deal).join(' · ')) + ')';
      if (item.pasta) nameHtml += ' (' + escapeHtml(pastaLines(item.pasta).join(' · ')) + ')';
      if (item.extras && item.extras.length) {
        var exNames = item.extras.map(function(e) { return escapeHtml(e.name); }).join(', ');
        nameHtml += '<br><small style="color:#7a7879">+ ' + exNames + '</small>';
      }
      if (item.note) {
        nameHtml += '<br><small style="color:#8a6d00">Notiz: ' + escapeHtml(item.note) + '</small>';
      }
      return '<div class="checkout-item">' +
        '<div><span class="checkout-item-name">' + nameHtml + '</span><br><span class="checkout-item-qty">' + item.qty + ' × ' + item.price.toFixed(2).replace('.',',') + ' €</span></div>' +
        '<span>' + formatEUR(item.price * item.qty) + '</span>' +
      '</div>';
    }).join('');

    var sub = getSubtotal();
    var fee = getDeliveryFee(sub);
    var total = getTotal();

    document.getElementById('checkoutSubtotal').textContent = formatEUR(sub);
    var coFeeRow = document.getElementById('checkoutDeliveryRow');
    if (coFeeRow) coFeeRow.style.display = orderType === 'abholung' ? 'none' : '';
    document.getElementById('checkoutDelivery').textContent = fee === 0 ? 'Kostenfrei' : formatEUR(fee);
    document.getElementById('checkoutTotal').textContent = formatEUR(total);
    var stickyTotal = document.getElementById('stickyTotal');
    if (stickyTotal) stickyTotal.textContent = formatEUR(total);

    var discRow = document.getElementById('checkoutDiscountRow');
    var discEl = document.getElementById('checkoutDiscount');
    if (discount.value > 0 && discRow && discEl) {
      discRow.style.display = 'flex';
      discEl.textContent = '−' + formatEUR(discount.value);
    } else if (discRow) {
      discRow.style.display = 'none';
    }
  }

  // Expose methods
  return {
    init: init,
    addItem: addItem,
    removeItem: removeItem,
    removeExtra: removeExtra,
    setItemNote: setItemNote,
    updateQty: updateQty,
    getSubtotal: getSubtotal,
    getDeliveryFee: getDeliveryFee,
    getTotal: getTotal,
    getItems: function() { return items; },
    getOrderType: getOrderType,
    setOrderType: setOrderType,
    needsPickupOnly: needsPickupOnly,
    applyPickupRules: applyPickupRules,
    isValidPhone: isValidPhone,
    getZoneMin: getZoneMin,
    getDiscount: function() { return discount; },
    applyDiscount: applyDiscount,
    clearDiscount: clearDiscount,
    renderCartPage: renderCartPage,
    renderCheckoutSummary: renderCheckoutSummary,
    getWishState: function() { return wishState; },
    getMinPreorderMin: minPreorderMin
  };
})();

// Initialize cart on page load
document.addEventListener('DOMContentLoaded', function() {
  Cart.init();

  // Coupon code
  var applyBtn = document.getElementById('applyCoupon');
  var couponInput = document.getElementById('couponCode');
  var couponMsg = document.getElementById('couponMessage');
  if (applyBtn && couponInput && couponMsg) {
    applyBtn.addEventListener('click', function() {
      var code = couponInput.value.trim().toUpperCase();
      if (!code) return;
      var result = Cart.applyDiscount(code);
      couponMsg.textContent = result.message;
      couponMsg.className = 'coupon-message ' + (result.valid ? 'success' : 'error');
      if (result.valid) Cart.renderCartPage();
    });
  }

  // Checkout form
  var checkoutForm = document.getElementById('checkoutForm');
  if (checkoutForm) {
    Cart.renderCheckoutSummary();

    checkoutForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var items = Cart.getItems();
      if (items.length === 0) { alert('Ihr Warenkorb ist leer.'); return; }

      var formData = new FormData(checkoutForm);

      if (!Cart.isValidPhone(formData.get('phone'))) {
        alert('Bitte geben Sie eine gültige Telefonnummer an (z. B. 0151 23456789).');
        var phoneInput = document.getElementById('phone');
        if (phoneInput) { phoneInput.style.borderColor = 'var(--primary)'; phoneInput.focus(); }
        return;
      }

      // Liefergebiet: vom Client bereits als außerhalb erkannt -> direkt blocken (Server prüft erneut)
      if (Cart.getOrderType() === 'lieferung' && window.DeliveryCheck && window.DeliveryCheck.blocked) {
        var dc = window.deliveryConfig || { phone: '04131 4006817' };
        alert('Ihre Adresse liegt über 15 km Fahrstrecke von uns entfernt. Bitte rufen Sie uns an: ' + dc.phone + ' – oder wählen Sie Abholung.');
        return;
      }

      // Zonen-Mindestbestellwert prüfen
      var zoneMin = Cart.getZoneMin ? Cart.getZoneMin() : null;
      if (zoneMin != null && Cart.getSubtotal() < zoneMin - 1e-9) {
        alert('Der Mindestbestellwert für Ihre Entfernung beträgt ' + zoneMin.toFixed(2).replace('.', ',') + ' € (Zwischensumme). Bitte fügen Sie noch Artikel hinzu.');
        return;
      }

      // Wunschtermin prüfen (mind. Mindestvorlauf, 12:00–00:00 Uhr, max. Vorausbuchung)
      var wishTime = null;
      var ws = Cart.getWishState();
      if (ws.mode === 'wish') {
        var wd = ws.value ? new Date(ws.value) : null;
        var need = Cart.getMinPreorderMin();
        if (!wd || isNaN(wd.getTime()) || wd.getTime() < Date.now() + need * 60000 - 60000) {
          alert('Bitte wählen Sie einen Wunschtermin mindestens ' + need + ' Minuten in der Zukunft.');
          var wi = document.querySelector('.time-sub:not([style*="none"]) input[type="datetime-local"]');
          if (wi) wi.focus();
          return;
        }
        if (wd.getHours() < 12) {
          alert('Wunschtermine sind nur zwischen 12:00 und 00:00 Uhr möglich.');
          return;
        }
        var maxAhead = (Cart.getOrderType() === 'abholung' ? 7 : 30) * 86400000;
        if (wd.getTime() > Date.now() + maxAhead) {
          alert(Cart.getOrderType() === 'abholung' ? 'Abholung ist maximal 7 Tage im Voraus buchbar.' : 'Bitte wählen Sie einen früheren Termin.');
          return;
        }
        wishTime = ws.value; // "YYYY-MM-DDTHH:MM" (wird serverseitig als Berlin-Zeit geprüft)
      }

      var data = {
        name: formData.get('name'),
        email: (formData.get('email') || '').trim(),
        phone: formData.get('phone'),
        address: formData.get('address'),
        city: formData.get('city'),
        zip: formData.get('zip'),
        notes: formData.get('notes'),
        payment: formData.get('payment'),
        orderType: Cart.getOrderType(),
        wish_time: wishTime,
        items: items.map(function(i) { return { id: i.id, name: i.name, price: i.price, qty: i.qty, size: i.size, extras: (i.extras || []).map(function(e) { return e.name; }), note: i.note || '', menue: i.menue || null, sauce: i.sauce || null, sauces: (i.sauces && i.sauces.length) ? i.sauces : null, box: i.box || null, chocos: (i.chocos && i.chocos.length) ? i.chocos : null, deal: i.deal || null, pasta: i.pasta || null }; }),
        subtotal: Cart.getSubtotal(),
        delivery_fee: Cart.getDeliveryFee(Cart.getSubtotal()),
        discount: Cart.getDiscount().value,
        discount_code: Cart.getDiscount().code,
        total: Cart.getTotal()
      };

      var submitBtn = document.getElementById('submitOrder');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wird gesendet...'; }

      fetch('/bestellung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': cartCsrfToken },
        body: JSON.stringify(data)
      })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.success) {
          localStorage.removeItem('feinCart');
          localStorage.removeItem('feinDiscount');
          if (result.stripeUrl) { window.location.href = result.stripeUrl; return; }
          window.location.href = '/bestellung/bestellung/' + result.orderNumber;
        } else {
          alert(result.message || 'Fehler bei der Bestellung');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-check"></i> Zahlungspflichtig bestellen'; }
        }
      })
      .catch(function() {
        alert('Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-check"></i> Zahlungspflichtig bestellen'; }
      });
    });
  }
});
