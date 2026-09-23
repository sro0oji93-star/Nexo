// Extras & Beläge für Pizza (Preisliste EXTRAS & BELÄGE)
// Preise hängen von der gewählten Pizzagröße ab.
const KAESERAND = 'Käserand';

const EXTRA_PRICES = {
  '26 cm': { belag: 1.60, fisch: 2.70, kaeserand: 2.40 },
  '30 cm': { belag: 1.90, fisch: 3.20, kaeserand: 2.80 },
  'Familien Pizza': { belag: 2.60, fisch: 4.20, kaeserand: 3.90 },
  'Party 60x40': { belag: 4.20, fisch: 6.20, kaeserand: 5.00 }
};

const TOPPINGS = [
  'Salami', 'Gouda', 'Schinken', 'Champignons', 'Ananas', 'Tomaten', 'Basilikum',
  'Mozzarella', 'Thunfisch', 'Rote Zwiebeln', 'Scampi', 'Frutti di Mare',
  'Hähnchen', 'Paprika', 'Brokkoli', 'Hackfleisch', 'Rinderhackfleisch',
  'Hirtenkäse', 'Feta', 'Röstzwiebeln', 'Sucuk', 'Ei', 'Bacon',
  'Würstchen', 'Gewürzgurken', 'Jalapeños', 'Krispy Chicken', 'Mais',
  'Lachs', 'Rucola', 'Pute', 'Oregano', 'Creme Fraiche', 'Oliven'
];

// Anzeige-Labels (Allergene/Zusatzstoffe) für die Extra-Beläge-Box – nur Anzeige,
// Preise/Logik unverändert. data-extra-name bleibt der reine Name.
const BELAG_LABELS = {
  'Salami': '[2,3]', 'Gouda': '[g]', 'Schinken': '[2,3,8]',
  'Mozzarella': '[g]', 'Thunfisch': '[d]', 'Scampi': '[b]', 'Frutti di Mare': '[b,n]',
  'Hirtenkäse': '[g]', 'Feta': '[g]', 'Röstzwiebeln': '[a1]', 'Sucuk': '[j,2,3,4,8]',
  'Ei': '[c]', 'Bacon': '[2,3]', 'Würstchen': '[2]', 'Krispy Chicken': '[a1,a3]',
  'Lachs': '[d]', 'Creme Fraiche': '[g]', 'Oliven': '[6]'
};

const FISH_TOPPINGS = ['Thunfisch', 'Scampi', 'Frutti di Mare', 'Lachs'];
const fishSet = new Set(FISH_TOPPINGS);

function getExtraPrice(sizeLabel, name) {
  // Alias für alte Warenkörbe (vor Umbenennung): gleicher Preis/Typ wie Krispy Chicken.
  if (name === 'Crispy Chicken') name = 'Krispy Chicken';
  const tier = EXTRA_PRICES[sizeLabel];
  if (!tier) return null;
  if (name === KAESERAND) return { name, price: tier.kaeserand, type: 'kaeserand' };
  if (!TOPPINGS.includes(name)) return null;
  const isFish = fishSet.has(name);
  return { name, price: isFish ? tier.fisch : tier.belag, type: isFish ? 'fisch' : 'belag' };
}

// names: Array aus Strings oder {name}-Objekten (vom Client).
// Wirft bei unbekanntem Extra. Doppelte werden ignoriert.
// opts.wunsch (nur NEXO Wunsch): die ersten 3 Beläge sind gratis, jeder weitere
// Belag kostet den Listenpreis. Fisch/Käserand sind nie gratis (Premium).
function validateExtras(sizeLabel, names, opts) {
  if (!names) return { extras: [], total: 0 };
  if (!Array.isArray(names)) throw new Error('Ungültige Extras');
  const wunsch = !!(opts && opts.wunsch);
  const seen = new Set();
  const extras = [];
  let total = 0;
  let freeBelagLeft = wunsch ? 3 : 0;
  for (const entry of names) {
    const n = typeof entry === 'string' ? entry : (entry && entry.name);
    if (typeof n !== 'string' || seen.has(n)) continue;
    const e = getExtraPrice(sizeLabel, n);
    if (!e) throw new Error('Ungültiges Extra: ' + n);
    seen.add(n);
    if (wunsch && e.type === 'belag' && freeBelagLeft > 0) {
      freeBelagLeft--;
      extras.push({ name: e.name, price: 0, type: e.type });
      continue;
    }
    extras.push(e);
    total += e.price;
  }
  return { extras, total: parseFloat(total.toFixed(2)) };
}

module.exports = { EXTRA_PRICES, TOPPINGS, BELAG_LABELS, FISH_TOPPINGS, KAESERAND, getExtraPrice, validateExtras };
