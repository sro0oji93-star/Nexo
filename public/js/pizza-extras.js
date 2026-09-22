/* Pizza Extras & Beläge – zeigt Preise je nach gewählter Größe an.
   Erwartet window.PIZZA_EXTRA_PRICES = { "<sizeLabel>": { belag, fisch, kaeserand } } */
(function() {
  // Grüne Auswahl-Markierung für gewählte Extras (einmalig ins <head>)
  var css = '.pizza-extras label.extra-on{border-color:#22c55e !important;background:#f0fdf4 !important;}' +
    '.pizza-extras label.extra-on .extra-tick{display:inline !important;}' +
    '.pizza-extras label.extra-on .extra-price{color:#16a34a !important;}';
  var st = document.createElement('style');
  st.setAttribute('data-pizza-extras-style', '1');
  st.textContent = css;
  if (!document.querySelector('style[data-pizza-extras-style]')) document.head.appendChild(st);

  function paintExtra(cb) {
    var label = cb.closest ? cb.closest('label') : null;
    if (!label) return;
    if (cb.checked) label.classList.add('extra-on');
    else label.classList.remove('extra-on');
  }

  function sizeLabelFor(productId) {
    var radio = document.querySelector('input[name="size_' + productId + '"]:checked');
    if (!radio) radio = document.querySelector('input[name="detailSize"]:checked');
    return radio ? radio.getAttribute('data-label') : null;
  }

  function fmt(n) {
    return '+' + n.toFixed(2).replace('.', ',') + ' €';
  }

  function refreshBox(box) {
    var pid = box.getAttribute('data-extras-for');
    var label = sizeLabelFor(pid);
    var tiers = window.PIZZA_EXTRA_PRICES || {};
    var tier = label ? tiers[label] : null;
    var boxes = box.querySelectorAll('input[type="checkbox"][data-extra-name]');
    for (var i = 0; i < boxes.length; i++) {
      (function(cb) {
        paintExtra(cb);
        var type = cb.getAttribute('data-extra-type');
        var span = cb.closest('label').querySelector('.extra-price');
        var p = tier ? tier[type] : null;
        if (p == null || isNaN(parseFloat(p))) {
          if (span) span.textContent = '';
          cb.setAttribute('data-extra-price', '');
        } else {
          var num = parseFloat(p);
          if (span) span.textContent = fmt(num);
          cb.setAttribute('data-extra-price', num.toFixed(2));
        }
      })(boxes[i]);
    }
    // Nur NEXO Wunsch: danach erste 3 gecheckte Beläge gratis (Server-Regel).
    if (box.hasAttribute('data-wunsch')) reassignFree(box);
  }

  // Stellt sicher, dass bei Wunsch genau die ersten 3 gecheckten Beläge gratis sind
  // (unabhängig von An-/Abwahl-Reihenfolge – identisch zur Server-Regel).
  function reassignFree(box) {
    var freeLeft = 3;
    var boxes = box.querySelectorAll('input[type="checkbox"][data-extra-name]');
    for (var i = 0; i < boxes.length; i++) {
      (function(cb) {
        if (cb.getAttribute('data-extra-type') !== 'belag' || !cb.checked) return;
        var span = cb.closest('label').querySelector('.extra-price');
        if (freeLeft > 0) {
          freeLeft--;
          if (span) span.textContent = 'Gratis';
          cb.setAttribute('data-extra-price', '0.00');
        } else {
          var tier = (window.PIZZA_EXTRA_PRICES || {})[sizeLabelFor(box.getAttribute('data-extras-for'))];
          var p = tier ? tier.belag : null;
          if (p != null && !isNaN(parseFloat(p))) {
            if (span) span.textContent = fmt(parseFloat(p));
            cb.setAttribute('data-extra-price', parseFloat(p).toFixed(2));
          }
        }
      })(boxes[i]);
    }
  }

  function refreshAll() {
    var all = document.querySelectorAll('[data-extras-for]');
    for (var i = 0; i < all.length; i++) refreshBox(all[i]);
  }

  document.addEventListener('change', function(e) {
    if (e.target && e.target.matches && e.target.matches('input[name^="size_"], input[name="detailSize"]')) {
      refreshAll();
    }
    if (e.target && e.target.matches && e.target.matches('[data-extras-for] input[type="checkbox"]')) {
      // Wunsch-Boxen bei jedem Klick neu bepreisen (Gratis-Zähler hängt von Auswahl ab)
      var wbox = e.target.closest ? e.target.closest('[data-extras-for]') : null;
      if (wbox && wbox.hasAttribute('data-wunsch')) refreshBox(wbox);
      else paintExtra(e.target);
    }
  });
  document.addEventListener('DOMContentLoaded', refreshAll);
  refreshAll();
  window.refreshPizzaExtras = refreshAll;
})();
