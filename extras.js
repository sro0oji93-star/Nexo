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
  'Salami', 'Schinken', 'Champignons', 'Ananas', 'Tomaten', 'Basilikum',
  'Mozzarella', 'Thunfisch', 'Rote Zwiebeln', 'Scampi', 'Frutti di Mare',
  'Hähnchen', 'Paprika', 'Brokkoli', 'Hackfleisch', 'Rinderhackfleisch',
  'Hirtenkäse', 'Feta', 'Röstzwiebeln', 'Sucuk', 'Ei', 'Bacon',
  'Würstchen', 'Gewürzgurken', 'Jalapeños', 'Crispy Chicken', 'Mais',
  'Lachs', 'Rucola', 'Pute', 'Oregano'
];

const FISH_TOPPINGS = ['Thunfisch', 'Scampi', 'Frutti di Mare', 'Lachs'];
const fishSet = new Set(FISH_TOPPINGS);

function getExtraPrice(sizeLabel, name) {
  const tier = EXTRA_PRICES[sizeLabel];
  if (!tier) return null;
  if (name === KAESERAND) return { name, price: tier.kaeserand, type: 'kaeserand' };
  if (!TOPPINGS.includes(name)) return null;
  const isFish = fishSet.has(name);
  return { name, price: isFish ? tier.fisch : tier.belag, type: isFish ? 'fisch' : 'belag' };
}

// names: Array aus Strings oder {name}-Objekten (vom Client).
// Wirft bei unbekanntem Extra. Doppelte werden ignoriert.
function validateExtras(sizeLabel, names) {
  if (!names) return { extras: [], total: 0 };
  if (!Array.isArray(names)) throw new Error('Ungültige Extras');
  const seen = new Set();
  const extras = [];
  let total = 0;
  for (const entry of names) {
    const n = typeof entry === 'string' ? entry : (entry && entry.name);
    if (typeof n !== 'string' || seen.has(n)) continue;
    const e = getExtraPrice(sizeLabel, n);
    if (!e) throw new Error('Ungültiges Extra: ' + n);
    seen.add(n);
    extras.push(e);
    total += e.price;
  }
  return { extras, total: parseFloat(total.toFixed(2)) };
}

module.exports = { EXTRA_PRICES, TOPPINGS, FISH_TOPPINGS, KAESERAND, getExtraPrice, validateExtras };
