// NEXO Box-Konfiguration: Auswahlgruppen pro Box (alle inklusive, ohne Aufpreis).
// Listen (sauces/snacks/pastas) kommen aus der DB, toppings aus extras.js.
const { TOPPINGS, FISH_TOPPINGS } = require('./extras');

// Mittag Deal (nexo-mittag-deal): Pizza 26cm ODER Baguette (Croque) + max. 3 Beläge (ohne Fisch) + 0,33l Getränk, alles inklusive.
const DEAL_SLUG = 'nexo-mittag-deal';
const DEAL_BASIS = ['Pizza Ø 26 cm', 'Baguette (Croque)'];
const DEAL_DRINKS = ['Coca-Cola', 'Fanta', 'Sprite', 'Mezzo Mix', 'Coca-Cola Zero'];
const DEAL_MAX_TOPPINGS = 3;

function dealToppingsNoFish() {
  const fish = new Set(FISH_TOPPINGS);
  return TOPPINGS.filter(t => !fish.has(t));
}

// choices: { basis, belaege[], croque, drink }. lists: { croques[] } (DB-Namen).
// Gibt { ok, error, lines } zurück. lines: [{ name, price: 0 }] für Küche/Bon.
function validateDeal(choices, lists) {
  if (!choices || typeof choices !== 'object') return { ok: false, error: 'Bitte Deal konfigurieren' };
  const basis = choices.basis;
  if (!DEAL_BASIS.includes(basis)) return { ok: false, error: 'Bitte Basis wählen (Pizza oder Baguette)' };
  const lines = [{ name: 'Basis: ' + basis, price: 0 }];
  if (basis === DEAL_BASIS[0]) {
    const allowed = dealToppingsNoFish();
    const arr = Array.isArray(choices.belaege) ? [...new Set(choices.belaege)] : [];
    if (arr.some(v => !allowed.includes(v))) return { ok: false, error: 'Ungültiger Belag' };
    if (arr.length > DEAL_MAX_TOPPINGS) return { ok: false, error: 'Maximal ' + DEAL_MAX_TOPPINGS + ' Beläge' };
    if (arr.length) lines.push({ name: 'Beläge: ' + arr.join(', '), price: 0 });
  } else {
    const croques = (lists && lists.croques) || [];
    if (typeof choices.croque !== 'string' || !croques.includes(choices.croque)) {
      return { ok: false, error: 'Bitte Croque-Sorte wählen' };
    }
    lines.push({ name: 'Croque: ' + choices.croque, price: 0 });
  }
  if (typeof choices.drink !== 'string' || !DEAL_DRINKS.includes(choices.drink)) {
    return { ok: false, error: 'Bitte Getränk 0,33 l wählen' };
  }
  lines.push({ name: 'Getränk 0,33 l: ' + choices.drink, price: 0 });
  return { ok: true, lines };
}

const BURGER_OPTS = ['Cheeseburger', 'Chickenburger'];

const MIX_FLAVORS = ['Vanille', 'Schokolade', 'Erdbeere', 'Banane'];

const BOX_DEFS = {
  'box-1': [
    { key: 'burger1', type: 'radio', label: 'Burger 1', options: BURGER_OPTS },
    { key: 'burger2', type: 'radio', label: 'Burger 2', options: BURGER_OPTS },
    { key: 'sauces', type: 'check', min: 3, max: 3, label: 'Saucen', title: '3 Saucen nach Wahl', source: 'sauces' },
  ],
  'box-2': [
    { key: 'burger1', type: 'radio', label: 'Burger 1', options: BURGER_OPTS },
    { key: 'burger2', type: 'radio', label: 'Burger 2', options: BURGER_OPTS },
    { key: 'snacks', type: 'radio', label: 'Snacks', title: '6 Snacks nach Wahl', source: 'snacks' },
    { key: 'toppings', type: 'check', min: 3, max: 3, label: 'Pizza-Zutaten', title: 'Pizza: 3 Zutaten nach Wahl', source: 'toppings' },
    { key: 'sauces', type: 'check', min: 3, max: 3, label: 'Saucen', title: '3 Saucen nach Wahl', source: 'sauces' },
  ],
  'box-3': [
    { key: 'burger', type: 'radio', label: 'Burger', options: BURGER_OPTS },
    { key: 'pasta', type: 'radio', label: 'Pasta', source: 'pastas' },
    { key: 'toppings', type: 'check', min: 3, max: 3, label: 'Pizza-Zutaten', title: 'Pizza: 3 Zutaten nach Wahl', source: 'toppings' },
    { key: 'sauces', type: 'check', min: 2, max: 2, label: 'Saucen', title: '2 Saucen nach Wahl', source: 'sauces' },
  ],
  'mix-milkshake': [
    { key: 'sorten', type: 'check', min: 2, max: 2, label: 'Sorten', title: '2 Sorten nach Wahl', options: MIX_FLAVORS },
  ],
};

const BOX_SLUGS = Object.keys(BOX_DEFS);

// Gruppen mit echten Options-Arrays auflösen (für Views)
function resolveGroups(boxSlug, lists) {
  const defs = BOX_DEFS[boxSlug];
  if (!defs) return null;
  return defs.map(g => ({
    key: g.key,
    type: g.type,
    label: g.label,
    title: g.title || g.label,
    max: g.max || null,
    options: g.options || (lists && lists[g.source]) || [],
  }));
}

// Box-Auswahl serverseitig prüfen. Gibt { ok, error, lines } zurück.
// lines: [{ name, price: 0 }] für Küche/Admin-Anzeige.
function validateBox(boxSlug, box, lists) {
  const defs = BOX_DEFS[boxSlug];
  if (!defs) return { ok: false, error: 'Unbekannte Box' };
  if (!box || typeof box !== 'object') return { ok: false, error: 'Bitte Box konfigurieren' };
  const lines = [];
  for (const g of defs) {
    const val = box[g.key];
    const allowed = g.options || (lists && lists[g.source]) || [];
    if (g.type === 'radio') {
      if (typeof val !== 'string' || !allowed.includes(val)) {
        return { ok: false, error: 'Bitte ' + g.label + ' wählen' };
      }
      lines.push({ name: g.label + ': ' + val, price: 0 });
    } else {
      const arr = Array.isArray(val) ? [...new Set(val)] : [];
      const min = (g.min != null) ? g.min : 0;
      if (arr.some(v => !allowed.includes(v)) || arr.length > g.max) {
        return { ok: false, error: 'Maximal ' + g.max + '× ' + g.label };
      }
      if (arr.length < min) {
        return { ok: false, error: 'Bitte ' + min + '× ' + g.label + ' wählen (noch ' + (min - arr.length) + ')' };
      }
      if (arr.length) lines.push({ name: g.label + ': ' + arr.join(', '), price: 0 });
    }
  }
  return { ok: true, lines };
}

module.exports = { BOX_DEFS, BOX_SLUGS, BURGER_OPTS, resolveGroups, validateBox, DEAL_SLUG, DEAL_BASIS, DEAL_DRINKS, DEAL_MAX_TOPPINGS, dealToppingsNoFish, validateDeal };
