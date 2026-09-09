// Header scroll
(function() {
  var header = document.getElementById('mad-header');
  if (!header) return;

  function onScroll() {
    header.classList.toggle('scrolled', window.scrollY > 80);
  }
  window.addEventListener('scroll', onScroll);
  onScroll();
})();

// Mobile nav toggle
(function() {
  var btn = document.querySelector('.mad-mobile-nav-btn');
  var nav = document.querySelector('.mad-navigation--vertical-sm');
  if (!btn || !nav) return;

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    btn.classList.toggle('mad-opened');
    nav.classList.toggle('mad-opened');
  });

  // Close on outside click
  document.addEventListener('click', function(e) {
    if (!btn.contains(e.target) && !nav.contains(e.target)) {
      btn.classList.remove('mad-opened');
      nav.classList.remove('mad-opened');
    }
  });

  // Prevent nav clicks from closing parent
  nav.addEventListener('click', function(e) {
    e.stopPropagation();
  });
})();

// Mobile nav: prevent body scroll when nav open
(function() {
  var nav = document.querySelector('.mad-navigation--vertical-sm');
  var btn = document.querySelector('.mad-mobile-nav-btn');
  if (!nav || !btn) return;

  var observer = new MutationObserver(function() {
    if (nav.classList.contains('mad-opened')) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  });
  observer.observe(nav, { attributes: true, attributeFilter: ['class'] });
})();

// Counter animation
(function() {
  const counters = document.querySelectorAll('.stat-number');
  if (counters.length === 0) return;

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseFloat(el.getAttribute('data-target'));
        const isFloat = target % 1 !== 0;
        const duration = 2000;
        const start = performance.now();

        function animate(time) {
          const elapsed = time - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = target * eased;
          el.textContent = isFloat ? current.toFixed(1) : Math.round(current);
          if (progress < 1) requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(function(c) { observer.observe(c); });
})();

// Menu filter
(function() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  if (filterBtns.length === 0) return;

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      var cats = document.querySelectorAll('.menu-category');
      if (cats.length <= 1) return;
      e.preventDefault();
      filterBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var filter = btn.getAttribute('data-filter') || 'all';
      cats.forEach(function(c) {
        c.style.display = (filter === 'all' || c.getAttribute('data-category') === filter) ? 'block' : 'none';
      });
    });
  });
})();

// Quantity selector
(function() {
  var qtyMinus = document.getElementById('qtyMinus');
  var qtyPlus = document.getElementById('qtyPlus');
  var qtyInput = document.getElementById('qtyInput');
  if (qtyMinus && qtyPlus && qtyInput) {
    qtyMinus.addEventListener('click', function() {
      var val = parseInt(qtyInput.value) || 1;
      if (val > 1) qtyInput.value = val - 1;
    });
    qtyPlus.addEventListener('click', function() {
      var val = parseInt(qtyInput.value) || 1;
      if (val < 20) qtyInput.value = val + 1;
    });
  }
})();

// Yummi qty selector
(function() {
  document.querySelectorAll('.quantity.size-2').forEach(function(group) {
    var input = group.querySelector('input[type="text"]');
    var plus = group.querySelector('.qty-plus');
    var minus = group.querySelector('.qty-minus');
    if (input && plus && minus) {
      plus.addEventListener('click', function() {
        var val = parseInt(input.value) || 1;
        if (val < 20) input.value = val + 1;
      });
      minus.addEventListener('click', function() {
        var val = parseInt(input.value) || 1;
        if (val > 1) input.value = val - 1;
      });
    }
  });
})();

// Banner slider auto-scroll
(function() {
  const slider = document.getElementById('bannerSlider');
  if (!slider) return;
  const slides = slider.querySelectorAll('.banner-slide');
  if (slides.length <= 1) return;
  let current = 0;
  slides.forEach(function(s, i) {
    if (i !== 0) s.style.display = 'none';
  });
  setInterval(function() {
    slides[current].style.display = 'none';
    current = (current + 1) % slides.length;
    slides[current].style.display = 'block';
    slides[current].style.animation = 'fadeInUp .5s ease-out';
  }, 5000);
})();

// Tabbed menu (for mad-tabs)
(function() {
  const tabLinks = document.querySelectorAll('.mad-tab-link');
  if (tabLinks.length === 0) return;

  tabLinks.forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var targetId = link.getAttribute('href').slice(1);
      var targetPanel = document.getElementById(targetId);
      if (!targetPanel) return;

      // Deactivate all in this tab group
      var tabGroup = link.closest('.mad-tabs');
      tabGroup.querySelectorAll('.mad-tab-link').forEach(function(l) {
        l.parentElement.classList.remove('mad-active');
        l.setAttribute('aria-selected', 'false');
      });
      tabGroup.querySelectorAll('.mad-tab').forEach(function(p) {
        p.classList.remove('mad-active');
      });

      // Activate current
      link.parentElement.classList.add('mad-active');
      link.setAttribute('aria-selected', 'true');
      targetPanel.classList.add('mad-active');
    });
  });
})();

// Testimonial carousel
(function() {
  var container = document.getElementById('testimonialSlide');
  var dots = document.querySelectorAll('.carousel-dot');
  var prevBtn = document.getElementById('testPrev');
  var nextBtn = document.getElementById('testNext');
  if (!container) return;

  // Fetch testimonials via data attribute or skip
  var dataEl = document.getElementById('testimonialData');
  var testimonials = dataEl ? JSON.parse(dataEl.textContent || '[]') : [];
  if (testimonials.length === 0) { container.innerHTML = '<p style="text-align:center;color:#999">Noch keine Bewertungen</p>'; return; }

  var current = 0;

  function render(index) {
    var t = testimonials[index];
    if (!t) return;
    var stars = '';
    for (var i = 0; i < 5; i++) {
      stars += '<i class="fas fa-star' + (i < t.rating ? ' active' : '') + '"></i>';
    }
    container.innerHTML =
      '<div class="testimonial-slide-stars">' + stars + '</div>' +
      '<p class="testimonial-slide-text">"' + t.text + '"</p>' +
      '<div class="testimonial-slide-author">' +
        '<div class="testimonial-slide-avatar">' + t.name.charAt(0) + '</div>' +
        '<div class="testimonial-slide-info">' +
          '<strong>' + t.name + '</strong>' +
          '<span>Kunde</span>' +
        '</div>' +
      '</div>';
    dots.forEach(function(d, i) {
      d.classList.toggle('active', i === index);
    });
  }

  dots.forEach(function(dot, i) {
    dot.addEventListener('click', function() { current = i; render(current); });
  });

  if (prevBtn) prevBtn.addEventListener('click', function() {
    current = (current - 1 + testimonials.length) % testimonials.length;
    render(current);
  });

  if (nextBtn) nextBtn.addEventListener('click', function() {
    current = (current + 1) % testimonials.length;
    render(current);
  });

  if (testimonials.length > 1) {
    setInterval(function() {
      current = (current + 1) % testimonials.length;
      render(current);
    }, 5000);
  }
})();



/* Leichter Bildschutz: Rechtsklick + Ziehen auf Bildern blockieren (nur Frontend) */
(function() {
  document.addEventListener('contextmenu', function(e) {
    var t = e.target && e.target.closest ? e.target.closest('img') : null;
    if (t) e.preventDefault();
  });
  document.addEventListener('dragstart', function(e) {
    var t = e.target && e.target.closest ? e.target.closest('img') : null;
    if (t) e.preventDefault();
  });
})();
