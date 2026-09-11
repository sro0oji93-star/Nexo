// Produktsuche (live, Name + Kategorie)
function filterProducts() {
  var q = (document.getElementById('productSearch').value || '').toLowerCase().trim();
  document.querySelectorAll('#productsTable tbody tr').forEach(function(row) {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// Auswahl-Box-Presets für Größen/Auswahlen (Labels passend zu Menü-Logik)
var CHOICE_PRESETS = {
  sauces: ['Knoblauch', 'American', 'Remoulade', 'NEXO Haus', 'Chili', 'BBQ', 'Curry'],
  dressings: ['Knoblauch', 'Hausdressing', 'Yoghurt', 'American', 'Kräuter'],
  beilagen: ['Reis', 'Pommes'],
  drinks: ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'],
  stk612: ['6 Stk.', '12 Stk.']
};
var CHOICE_PREFIX = { sauces: 'Sauce: ', dressings: 'Dressing: ', beilagen: 'Beilage: ', drinks: 'Menü mit ', stk612: '' };
function fillPreset(kind, builderId) {
  var builder = document.getElementById(builderId);
  var form = builder.closest('form');
  var base = parseFloat(form.querySelector('input[name="price"]').value);
  if (isNaN(base)) {
    alert('Bitte zuerst einen Preis eingeben – die Auswahl übernimmt ihn.');
    form.querySelector('input[name="price"]').focus();
    return;
  }
  var rows = builder.querySelector('.sizes-rows');
  rows.innerHTML = '';
  CHOICE_PRESETS[kind].forEach(function(nm, idx) {
    var price = base;
    if (kind === 'drinks') price = parseFloat((base + 5).toFixed(2));
    if (kind === 'stk612' && idx === 1) price = parseFloat((base + 4).toFixed(2));
    addSizeRow(rows, CHOICE_PREFIX[kind] + nm, price);
  });
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('active');
  }
});

function editProduct(product) {
  document.getElementById('edit_name').value = product.name;
  document.getElementById('edit_category_id').value = product.category_id || '';
  document.getElementById('edit_price').value = product.price;
  document.getElementById('edit_old_price').value = product.old_price || '';
  document.getElementById('edit_description').value = product.description || '';
  document.getElementById('edit_ingredients').value = product.ingredients || '';
  document.getElementById('edit_allergene').value = product.allergene || '';
  document.getElementById('edit_zusatzstoffe').value = product.zusatzstoffe || '';
  document.getElementById('edit_sort_order').value = product.sort_order || 0;
  document.getElementById('edit_is_featured').checked = product.is_featured == 1;
  document.getElementById('edit_is_available').checked = product.is_available == 1;
  document.getElementById('editProductForm').action = '/admin/produkte/bearbeiten/' + product.id;
  // Populate size rows
  var container = document.querySelector('#editSizesBuilder .sizes-rows');
  container.innerHTML = '';
  if (product.sizes) {
    try {
      JSON.parse(product.sizes).forEach(function(s) { addSizeRow(container, s.label, s.price); });
    } catch(e) {}
  }
  openModal('editProductModal');
}

function editCategory(cat) {
  document.getElementById('cat_name').value = cat.name;
  document.getElementById('cat_description').value = cat.description || '';
  document.getElementById('cat_sort_order').value = cat.sort_order || 0;
  document.getElementById('cat_active').checked = cat.active == 1;
  document.getElementById('editCategoryForm').action = '/admin/kategorien/bearbeiten/' + cat.id;
  openModal('editCategoryModal');
}

function addSizeRow(ref, label, price) {
  var container = ref.tagName === 'BUTTON' ? ref.parentElement : ref;
  var row = document.createElement('div');
  row.className = 'size-row';
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center';
  var inp1 = document.createElement('input');
  inp1.type = 'text'; inp1.placeholder = 'z.B. Klein'; inp1.className = 'size-label';
  inp1.style.cssText = 'flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:6px';
  if (label) inp1.value = label;
  var inp2 = document.createElement('input');
  inp2.type = 'number'; inp2.step = '0.01'; inp2.placeholder = 'Preis'; inp2.className = 'size-price';
  inp2.style.cssText = 'flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:6px';
  if (price) inp2.value = price;
  var btn = document.createElement('button');
  btn.type = 'button'; btn.innerHTML = '&times;'; btn.style.cssText = 'padding:4px 12px;border:none;border-radius:6px;background:#e74c3c;color:#fff;cursor:pointer;font-size:18px;line-height:1';
  btn.onclick = function() { row.remove(); };
  row.appendChild(inp1); row.appendChild(inp2); row.appendChild(btn);
  var addBtn = container.querySelector('.add-size-btn');
  if (addBtn) container.insertBefore(row, addBtn);
  else container.appendChild(row);
}

// Build sizes JSON on form submit
document.addEventListener('submit', function(e) {
  var form = e.target;
  var container = form.querySelector('.sizes-rows');
  if (!container) return;
  var sizes = [];
  container.querySelectorAll('.size-row').forEach(function(row) {
    var label = row.querySelector('.size-label').value.trim();
    var price = parseFloat(row.querySelector('.size-price').value);
    if (label && !isNaN(price)) sizes.push({ label: label, price: price });
  });
  form.querySelector('input[name="sizes"]').value = sizes.length ? JSON.stringify(sizes) : '';
});

(function() {
  var toggle = document.getElementById('sidebarToggle');
  var sidebar = document.querySelector('.admin-sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', function() {
      sidebar.classList.toggle('active');
    });
  }
})();

(function() {
  var alerts = document.querySelectorAll('.alert');
  alerts.forEach(function(a) {
    setTimeout(function() { a.style.opacity = '0'; }, 4000);
    setTimeout(function() { a.style.display = 'none'; }, 4500);
  });
})();
