const db = require('../db');

async function seed() {
  await db.initialize();

  const categories = [
    ['Pizza', 'pizza', 'Steinofenpizza in 4 Größen: 26 cm, 30 cm, Familien Pizza und Party. Alle Pizzen in 26 cm und 30 cm auch als Calzone erhältlich.', 1],
    ['Burger', 'burger', 'Smash Burger frisch für dich gesmasht. Für nur 5,00 € Aufpreis als Menü: 4 Zwiebelringe oder Pommes und ein 0,33 l Softdrink nach Wahl.', 2],
    ['Croque', 'croque', 'Frisch überbackene Croques. Inklusive 1 Sauce nach Wahl.', 3],
    ['Salat', 'salat', 'Frische Salate mit Dressing nach Wahl: Knoblauch, Hausdressing, Yoghurt, American, Kräuter.', 4],
    ['Pasta', 'pasta', 'Italienische Pastagerichte, traditionell und kreativ', 5],
    ['Schnitzel', 'schnitzel', 'Inklusive Pommes oder Kroketten.', 6],
    ['Snacks', 'snacks', 'Menü-Aufpreis +4,00 €: mit Pommes und 0,33 l Softdrink nach Wahl.', 7],
    ['Getränke', 'getraenke', 'Erfrischende Getränke und Erfrischungen', 8],
    ['Snack Rolls', 'snack-rolls', 'Herzhafte gefüllte Rollen, perfekt zum Teilen', 9],
    ['Saucen & Dips', 'saucen-dips', 'Alle Saucen je 2,00 €.', 10],
    ['Dessert', 'dessert', 'Süße Klassiker, Crêpes, Mini Pancakes & Mini Waffeln. Alle Crêpes inklusive 2 Schokoladensorten nach Wahl.', 11],
    ['Beilagen', 'beilagen', 'Knusprige Beilagen für jeden Geschmack.', 12],
    ['Fries', 'fries', 'Knusprige Fries für jeden Geschmack.', 13],
    ['NEXO Box', 'nexo-box', 'Gemeinsam genießen & sparen.', 14],
    ['Kids Menü', 'kids-menue', 'Bei allen Kids-Menüs inklusive: Capri-Sun, Überraschungsei.', 15],
    ['Milkshake', 'milkshake', 'Frisch gemixte Milkshakes.', 16]
  ];

  const products = [
    [1, 'Margherita', 'margherita', 'Tomatensauce, Oregano', 8.90, null, '/images/products/img1.jpg', 'Tomatensauce, Oregano', 1, 1, '[{"label":"26 cm","price":8.9},{"label":"30 cm","price":11.5},{"label":"Familien Pizza","price":19.9},{"label":"Party 60x40","price":27.1}]'],
    [1, 'Mozzarella', 'mozzarella', 'Tomatensauce, Mozzarella, frische Tomaten, Basilikum, Oregano', 10.90, null, '/images/products/img1.jpg', 'Tomatensauce, Mozzarella, frische Tomaten, Basilikum, Oregano', 0, 2, '[{"label":"26 cm","price":10.9},{"label":"30 cm","price":13.5},{"label":"Familien Pizza","price":22.9},{"label":"Party 60x40","price":31.9}]'],
    [1, 'Cheese', 'cheese', 'Tomatensauce, verschiedene Käsesorten, Oregano', 10.90, null, '/images/products/img2.jpg', 'Tomatensauce, verschiedene Käsesorten, Oregano', 0, 3, '[{"label":"26 cm","price":10.9},{"label":"30 cm","price":13.5},{"label":"Familien Pizza","price":22.9},{"label":"Party 60x40","price":31.9}]'],
    [1, 'Salami', 'salami', 'Tomatensauce, Salami, Oregano', 10.20, null, '/images/products/img2.jpg', 'Tomatensauce, Salami, Oregano', 1, 4, '[{"label":"26 cm","price":10.2},{"label":"30 cm","price":12.5},{"label":"Familien Pizza","price":21.5},{"label":"Party 60x40","price":30.5}]'],
    [1, 'Prosciutto', 'prosciutto', 'Tomatensauce, Schinken, Oregano', 10.20, null, '/images/products/img3.jpg', 'Tomatensauce, Schinken, Oregano', 0, 5, '[{"label":"26 cm","price":10.2},{"label":"30 cm","price":12.5},{"label":"Familien Pizza","price":21.5},{"label":"Party 60x40","price":30.5}]'],
    [1, 'Funghi', 'funghi', 'Tomatensauce, Champignons, Oregano', 10.20, null, '/images/products/img1.jpg', 'Tomatensauce, Champignons, Oregano', 0, 6, '[{"label":"26 cm","price":10.2},{"label":"30 cm","price":12.5},{"label":"Familien Pizza","price":21.5},{"label":"Party 60x40","price":30.5}]'],
    [1, 'Dreiklang', 'dreiklang', 'Tomatensauce, Salami, Schinken, Champignons, Oregano', 12.40, null, '/images/products/img2.jpg', 'Tomatensauce, Salami, Schinken, Champignons, Oregano', 1, 7, '[{"label":"26 cm","price":12.4},{"label":"30 cm","price":14.9},{"label":"Familien Pizza","price":23.9},{"label":"Party 60x40","price":33.5}]'],
    [1, 'Hawaii', 'hawaii', 'Tomatensauce, Schinken, Ananas, Oregano', 12.20, null, '/images/products/img3.jpg', 'Tomatensauce, Schinken, Ananas, Oregano', 0, 8, '[{"label":"26 cm","price":12.2},{"label":"30 cm","price":14.5},{"label":"Familien Pizza","price":23.5},{"label":"Party 60x40","price":33}]'],
    [1, 'Vegetarisch', 'vegetarisch', 'Tomatensauce, verschiedene Gemüsesorten, Oregano', 12.20, null, '/images/products/img1.jpg', 'Tomatensauce, verschiedene Gemüsesorten, Oregano', 0, 9, '[{"label":"26 cm","price":12.2},{"label":"30 cm","price":14.5},{"label":"Familien Pizza","price":23.5},{"label":"Party 60x40","price":33}]'],
    [1, 'Tonno', 'tonno', 'Tomatensauce, Thunfisch, rote Zwiebeln, Oregano', 12.60, null, '/images/products/img2.jpg', 'Tomatensauce, Thunfisch, rote Zwiebeln, Oregano', 0, 10, '[{"label":"26 cm","price":12.6},{"label":"30 cm","price":14.9},{"label":"Familien Pizza","price":24},{"label":"Party 60x40","price":33.5}]'],
    [1, 'Scampi', 'scampi', 'Tomatensauce, Scampi, Oregano', 14.20, null, '/images/products/img3.jpg', 'Tomatensauce, Scampi, Oregano', 0, 11, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
    [1, 'Frutti di Mare', 'frutti-di-mare', 'Tomatensauce, Frutti di Mare, Oregano', 14.20, null, '/images/products/img1.jpg', 'Tomatensauce, Frutti di Mare, Oregano', 0, 12, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
    [1, 'Spezial Chicken', 'spezial-chicken', 'Tomatensauce, Hähnchen, Paprika, rote Zwiebeln, Champignons, Oregano', 13.40, null, '/images/products/img2.jpg', 'Tomatensauce, Hähnchen, Paprika, rote Zwiebeln, Champignons, Oregano', 1, 13, '[{"label":"26 cm","price":13.4},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
    [1, 'Chicken Hollandaise', 'chicken-hollandaise', 'Tomatensauce, Hähnchen, Brokkoli, Sauce Hollandaise, Oregano', 13.40, null, '/images/products/img3.jpg', 'Tomatensauce, Hähnchen, Brokkoli, Sauce Hollandaise, Oregano', 0, 14, '[{"label":"26 cm","price":13.4},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
    [1, 'Chicken Curry', 'chicken-curry', 'Tomatensauce, Hähnchen, Ananas, Curry, Oregano', 13.20, null, '/images/products/img1.jpg', 'Tomatensauce, Hähnchen, Ananas, Curry, Oregano', 0, 15, '[{"label":"26 cm","price":13.2},{"label":"30 cm","price":15.5},{"label":"Familien Pizza","price":24.5},{"label":"Party 60x40","price":34.5}]'],
    [1, 'Chicken Beef', 'chicken-beef', 'Tomatensauce, Hähnchen, Hackfleisch, Hirtenkäse, Oregano', 14.20, null, '/images/products/img2.jpg', 'Tomatensauce, Hähnchen, Hackfleisch, Hirtenkäse, Oregano', 0, 16, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
    [1, 'BBQ', 'bbq', 'Tomatensauce, Salami, Hackfleisch, BBQ-Sauce, Röstzwiebeln, Oregano', 13.90, null, '/images/products/img3.jpg', 'Tomatensauce, Salami, Hackfleisch, BBQ-Sauce, Röstzwiebeln, Oregano', 1, 17, '[{"label":"26 cm","price":13.9},{"label":"30 cm","price":16.2},{"label":"Familien Pizza","price":25.2},{"label":"Party 60x40","price":35.5}]'],
    [1, 'Hot Beef', 'hot-beef', 'Tomatensauce, Hackfleisch, Paprika, Jalapeños, Oregano', 13.60, null, '/images/products/img1.jpg', 'Tomatensauce, Hackfleisch, Paprika, Jalapeños, Oregano', 0, 18, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
    [1, 'Sucuk', 'sucuk', 'Tomatensauce, Sucuk, Peperoni, Ei, Oregano', 13.60, null, '/images/products/img2.jpg', 'Tomatensauce, Sucuk, Peperoni, Ei, Oregano', 0, 19, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
    [1, 'Bacon', 'bacon', 'Tomatensauce, Rinderhackfleisch, BBQ-Sauce, Mozzarella, Bacon, Oregano', 14.20, null, '/images/products/img3.jpg', 'Tomatensauce, Rinderhackfleisch, BBQ-Sauce, Mozzarella, Bacon, Oregano', 0, 20, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
    [1, 'Sucuk Jalapeños', 'sucuk-jalapenos', 'Tomatensauce, Sucuk, Jalapeños, Ei, Oregano', 13.60, null, '/images/products/img1.jpg', 'Tomatensauce, Sucuk, Jalapeños, Ei, Oregano', 0, 21, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
    [1, 'Meat Lovers', 'meat-lovers', 'Tomatensauce, Salami, Schinken, Sucuk, Rinderhackfleisch, Oregano', 14.90, null, '/images/products/img2.jpg', 'Tomatensauce, Salami, Schinken, Sucuk, Rinderhackfleisch, Oregano', 1, 22, '[{"label":"26 cm","price":14.9},{"label":"30 cm","price":17.2},{"label":"Familien Pizza","price":26.2},{"label":"Party 60x40","price":36.9}]'],
    [1, 'Hot Dog', 'hot-dog', 'Tomatensauce, Würstchen, Gewürzgurken, Röstzwiebeln, Oregano', 13.20, null, '/images/products/img3.jpg', 'Tomatensauce, Würstchen, Gewürzgurken, Röstzwiebeln, Oregano', 0, 23, '[{"label":"26 cm","price":13.2},{"label":"30 cm","price":15.5},{"label":"Familien Pizza","price":24.5},{"label":"Party 60x40","price":34.5}]'],
    [1, 'UFO', 'ufo', 'Tomatensauce, von allem etwas, doppelter Teig, Oregano', 15.20, null, '/images/products/img1.jpg', 'Tomatensauce, von allem etwas, doppelter Teig, Oregano', 0, 24, '[{"label":"26 cm","price":15.2},{"label":"30 cm","price":17.5},{"label":"Familien Pizza","price":26.9},{"label":"Party 60x40","price":37.9}]'],
    [1, 'NEXO Wunsch', 'nexo-wunsch', 'Tomatensauce, drei Zutaten nach Wahl, Oregano', 13.60, null, '/images/products/img2.jpg', 'Tomatensauce, drei Zutaten nach Wahl, Oregano', 0, 25, '[{"label":"26 cm","price":13.6},{"label":"30 cm","price":15.9},{"label":"Familien Pizza","price":24.9},{"label":"Party 60x40","price":34.9}]'],
    [1, 'NEXO X', 'nexo-x', 'Hollandaise, Crispy Chicken, Mais, Paprika, Knoblauchsauce', 14.20, null, '/images/products/img3.jpg', 'Hollandaise, Crispy Chicken, Mais, Paprika, Knoblauchsauce', 0, 26, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
    [1, 'NEXO Boom', 'nexo-boom', 'Tomatensauce, Salami, Hackfleisch, Paprika, Mais, Hirtenkäse, Oregano', 14.50, null, '/images/products/img1.jpg', 'Tomatensauce, Salami, Hackfleisch, Paprika, Mais, Hirtenkäse, Oregano', 1, 27, '[{"label":"26 cm","price":14.5},{"label":"30 cm","price":16.9},{"label":"Familien Pizza","price":25.9},{"label":"Party 60x40","price":36.5}]'],
    [1, 'NEXO Deluxe', 'nexo-deluxe', 'Crème fraîche, Lachs, Paprika, Rucola', 15.20, null, '/images/products/img2.jpg', 'Crème fraîche, Lachs, Paprika, Rucola', 0, 28, '[{"label":"26 cm","price":15.2},{"label":"30 cm","price":17.5},{"label":"Familien Pizza","price":26.9},{"label":"Party 60x40","price":37.9}]'],
    [1, 'NEXO Feuer Royale', 'nexo-feuer-royale', 'Tomatensauce, Hackfleisch, Jalapeños, Sauce Hollandaise, Feta, Oregano', 14.50, null, '/images/products/img3.jpg', 'Tomatensauce, Hackfleisch, Jalapeños, Sauce Hollandaise, Feta, Oregano', 0, 29, '[{"label":"26 cm","price":14.5},{"label":"30 cm","price":16.9},{"label":"Familien Pizza","price":25.9},{"label":"Party 60x40","price":36.5}]'],
    [1, 'NEXO Goldkrone', 'nexo-goldkrone', 'Tomatensauce, Pute, Brokkoli, Champignons, Sauce Hollandaise, Oregano', 14.20, null, '/images/products/img1.jpg', 'Tomatensauce, Pute, Brokkoli, Champignons, Sauce Hollandaise, Oregano', 0, 30, '[{"label":"26 cm","price":14.2},{"label":"30 cm","price":16.5},{"label":"Familien Pizza","price":25.5},{"label":"Party 60x40","price":35.9}]'],
    [2, 'Hamburger Smash', 'hamburger-smash', '110 g Smash Beef, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 8.90, null, '/images/products/img13.jpg', '110 g Smash Beef, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 0, 4],
    [2, 'Cheeseburger Smash', 'cheeseburger-smash', '110 g Smash Beef, Cheddar, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 9.90, null, '/images/products/img14.jpg', '110 g Smash Beef, Cheddar, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Burgersauce', 1, 5],
    [2, 'Chickenburger', 'chickenburger', 'Crispy Chicken, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Chicken Sauce', 9.90, null, '/images/products/img13.jpg', 'Crispy Chicken, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Chicken Sauce', 0, 6],
    [2, 'Fischburger', 'fischburger', 'Fischfilet, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Remoulade', 9.90, null, null, 'Fischfilet, Salat, Gewürzgurken, Tomate, rote Zwiebeln, Remoulade', 0, 7],
    [2, 'Veggieburger', 'veggieburger', 'Veggie Patty, Salat, Tomate, Veggie Sauce', 8.90, null, null, 'Veggie Patty, Salat, Tomate, Veggie Sauce', 0, 8],
    [2, 'Double Smash', 'double-smash', '2x 110 g Smash Beef, 2x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 12.90, null, null, '2x 110 g Smash Beef, 2x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 1, 9],
    [2, 'Triple Smash', 'triple-smash', '3x 110 g Smash Beef, 3x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 16.90, null, null, '3x 110 g Smash Beef, 3x Cheddar, Zwiebeln, Gewürzgurken, Smash Sauce', 0, 10],
    [2, 'Bacon BBQ Smash', 'bacon-bbq-smash', '2x 110 g Smash Beef, Cheddar, Bacon, Röstzwiebeln, Gewürzgurken, BBQ Sauce', 13.90, null, null, '2x 110 g Smash Beef, Cheddar, Bacon, Röstzwiebeln, Gewürzgurken, BBQ Sauce', 1, 11],
    [2, 'Mushroom Smash', 'mushroom-smash', '110 g Smash Beef, Champignons, karamellisierte Zwiebeln, Cheddar, Smash Sauce', 10.90, null, null, '110 g Smash Beef, Champignons, karamellisierte Zwiebeln, Cheddar, Smash Sauce', 0, 12],
    [2, 'Chicken Smash', 'chicken-smash', '110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, Chicken Sauce', 10.90, null, null, '110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, Chicken Sauce', 0, 13],
    [2, 'BoomBurger', 'boomburger', '3x 110 g Smash Beef, 3x Cheddar, Spiegelei, Champignons, Boom Sauce', 17.90, null, null, '3x 110 g Smash Beef, 3x Cheddar, Spiegelei, Champignons, Boom Sauce', 1, 14],
    [2, 'Beef & Chicken Smash', 'beef-chicken-smash', '110 g Smash Beef, 110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, NEXO Sauce', 13.90, null, null, '110 g Smash Beef, 110 g Smash Chicken, Cheddar, Zwiebeln, Gewürzgurken, NEXO Sauce', 0, 15],
    [3, 'NEXO Madame', 'nexo-madame', 'Tomate, Käse', 7.90, null, '/images/products/img7.jpg', 'Tomate, Käse', 0, 16],
    [3, 'NEXO Mozzarella', 'nexo-mozzarella', 'Mozzarella, Tomate, Käse', 8.50, null, '/images/products/img8.jpg', 'Mozzarella, Tomate, Käse', 1, 17],
    [3, 'NEXO Salami', 'nexo-salami', 'Salami, Käse', 8.90, null, '/images/products/img9.jpg', 'Salami, Käse', 0, 18],
    [3, 'NEXO Schinken', 'nexo-schinken', 'Schinken, Käse', 8.90, null, '/images/products/img7.jpg', 'Schinken, Käse', 0, 19],
    [3, 'NEXO Chicken', 'nexo-chicken', 'Hähnchen, Käse', 9.50, null, '/images/products/img8.jpg', 'Hähnchen, Käse', 0, 20],
    [3, 'NEXO Pute', 'nexo-pute', 'Putenbrust, Käse', 9.50, null, '/images/products/img9.jpg', 'Putenbrust, Käse', 0, 21],
    [3, 'NEXO Sucuk', 'nexo-sucuk', 'Sucuk, gekochtes Ei, Käse', 9.50, null, '/images/products/img7.jpg', 'Sucuk, gekochtes Ei, Käse', 1, 22],
    [3, 'NEXO Camembert', 'nexo-camembert', 'Camembert, Käse, Preiselbeeren', 9.90, null, '/images/products/img8.jpg', 'Camembert, Käse, Preiselbeeren', 0, 23],
    [3, 'NEXO Hawaii', 'nexo-hawaii', 'Schinken, Ananas, Käse', 9.50, null, '/images/products/img9.jpg', 'Schinken, Ananas, Käse', 0, 24],
    [3, 'NEXO Crispy', 'nexo-crispy', 'Crispy Chicken, Käse', 10.50, null, '/images/products/img7.jpg', 'Crispy Chicken, Käse', 1, 25],
    [3, 'NEXO Tuna', 'nexo-tuna', 'Thunfisch, Zwiebeln, Käse', 9.90, null, '/images/products/img8.jpg', 'Thunfisch, Zwiebeln, Käse', 0, 26],
    [3, 'NEXO Beef BBQ', 'nexo-beef-bbq', 'Rindfleisch, Käse, BBQ-Sauce', 10.90, null, '/images/products/img9.jpg', 'Rindfleisch, Käse, BBQ-Sauce', 1, 27],
    [3, 'NEXO Formaggi', 'nexo-formaggi', '4 Käsesorten', 10.50, null, '/images/products/img7.jpg', '4 Käsesorten', 0, 28],
    [4, 'Gemischter Salat', 'gemischter-salat', 'Eisbergsalat, Tomaten, Gurken, Mais. Dressing nach Wahl.', 7.90, null, '/images/products/img4.jpg', 'Eisbergsalat, Tomaten, Gurken, Mais', 0, 1, null],
    [4, 'Chicken Salat', 'chicken-salat', 'Gemischter Salat, gegrillte Hähnchenbrust. Dressing nach Wahl.', 10.90, null, '/images/products/img5.jpg', 'Gemischter Salat, gegrillte Hähnchenbrust', 1, 2, null],
    [4, 'Chef Salat', 'chef-salat', 'Gemischter Salat, Schinken, Thunfisch, gekochtes Ei. Dressing nach Wahl.', 11.90, null, '/images/products/img4.jpg', 'Gemischter Salat, Schinken, Thunfisch, gekochtes Ei', 1, 3, null],
    [4, 'Cheese Salat', 'cheese-salat', 'Gemischter Salat, 3 verschiedene Käsesorten. Dressing nach Wahl.', 10.90, null, '/images/products/img5.jpg', 'Gemischter Salat, 3 verschiedene Käsesorten', 0, 4, null],
    [4, 'Tuna Salat', 'tuna-salat', 'Gemischter Salat, Thunfisch, Zwiebeln, Oliven. Dressing nach Wahl.', 10.50, null, '/images/products/img4.jpg', 'Gemischter Salat, Thunfisch, Zwiebeln, Oliven', 0, 5, null],
    [4, 'Wunsch Salat', 'wunsch-salat', 'Gemischter Salat, 3 Zutaten nach Wahl. Dressing nach Wahl.', 11.90, null, '/images/products/img5.jpg', 'Gemischter Salat, 3 Zutaten nach Wahl', 0, 6, null],
    [5, 'NEXO Napoli', 'nexo-napoli', 'Tomatensauce', 8.90, null, '/images/products/img10.jpg', 'Tomatensauce', 1, 1, null],
    [5, 'NEXO Bolognese', 'nexo-bolognese', 'Rinderhack, Tomatensauce', 9.90, null, '/images/products/img11.jpg', 'Rinderhack, Tomatensauce', 0, 2, null],
    [5, 'NEXO Feuer', 'nexo-feuer', 'Tomatensauce, Knoblauch, Oliven, Jalapeños', 9.50, null, '/images/products/img10.jpg', 'Tomatensauce, Knoblauch, Oliven, Jalapeños', 0, 3, null],
    [5, 'NEXO Fusion', 'nexo-fusion', '2 verschiedene Nudelsorten, Hackfleisch, Crème fraîche, Tomatensoße', 11.50, null, '/images/products/img11.jpg', '2 verschiedene Nudelsorten, Hackfleisch, Crème fraîche, Tomatensoße', 0, 4, null],
    [5, 'NEXO Cheese', 'nexo-cheese', 'Vier Käsesorten in Sahnesauce', 11.50, null, '/images/products/img10.jpg', 'Vier Käsesorten in Sahnesauce', 0, 5, null],
    [5, 'NEXO Carbonara', 'nexo-carbonara', 'Schinken, Ei, Sahnesauce', 10.50, null, '/images/products/img11.jpg', 'Schinken, Ei, Sahnesauce', 1, 6, null],
    [5, 'NEXO Pesto', 'nexo-pesto', 'Hähnchen, Mais, Paprika, Basilikumpestosauce', 11.50, null, '/images/products/img10.jpg', 'Hähnchen, Mais, Paprika, Basilikumpestosauce', 0, 7, null],
    [5, 'NEXO Hawaii', 'pasta-hawaii', 'Hähnchen, Ananas, Curry, Sahnesauce', 11.50, null, '/images/products/img11.jpg', 'Hähnchen, Ananas, Curry, Sahnesauce', 0, 8, null],
    [5, 'NEXO Gamberi', 'nexo-gamberi', 'Garnelen, Knoblauch, Tomaten, Tomatensauce', 12.90, null, '/images/products/img10.jpg', 'Garnelen, Knoblauch, Tomaten, Tomatensauce', 0, 9, null],
    [5, 'NEXO Scampi Royal', 'nexo-scampi-royal', 'Scampi, Knoblauch, Tomaten-Sahnesauce', 13.90, null, '/images/products/img11.jpg', 'Scampi, Knoblauch, Tomaten-Sahnesauce', 1, 10, null],
    [5, 'NEXO Wunsch', 'pasta-wunsch', 'Zwei Zutaten und Sauce nach Wahl', 10.90, null, '/images/products/img10.jpg', 'Zwei Zutaten und Sauce nach Wahl', 0, 11, null],
    [5, 'NEXO Hähnchen Genuss', 'nexo-haehnchen-genuss', 'Hähnchen, Champignons, Paprika, Zwiebel, Sahnesauce', 11.50, null, '/images/products/img11.jpg', 'Hähnchen, Champignons, Paprika, Zwiebel, Sahnesauce', 0, 12, null],
    [5, 'NEXO Deluxe', 'pasta-nexo-deluxe', 'Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce', 12.90, null, '/images/products/img10.jpg', 'Crispy Chicken, Mais, Paprika, Hollandaise, Sahnesauce', 0, 13, null],
    [5, 'NEXO Signature', 'nexo-signature', 'Hähnchen, Mais, Brokkoli, Sahnesauce', 12.90, null, '/images/products/img11.jpg', 'Hähnchen, Mais, Brokkoli, Sahnesauce', 0, 14, null],
    [6, 'Schnitzel Wiener Art', 'schnitzel-wiener-art', 'Schnitzel, Zitrone', 13.90, null, '/images/products/img16.jpg', 'Schnitzel, Zitrone', 1, 1, null],
    [6, 'Jägerschnitzel', 'jaegerschnitzel', 'Schnitzel, Champignons, Jägersauce', 15.90, null, '/images/products/img17.jpg', 'Schnitzel, Champignons, Jägersauce', 0, 2, null],
    [6, 'Zigeunerschnitzel', 'zigeunerschnitzel', 'Schnitzel, Paprika, Zwiebeln, Paprikasauce', 15.90, null, '/images/products/img18.jpg', 'Schnitzel, Paprika, Zwiebeln, Paprikasauce', 0, 3, null],
    [6, 'Schnitzel Hollandaise', 'schnitzel-hollandaise', 'Schnitzel, Brokkoli, Sauce Hollandaise', 16.90, null, '/images/products/img16.jpg', 'Schnitzel, Brokkoli, Sauce Hollandaise', 1, 4, null],
    [7, 'Currywurst mit Pommes', 'currywurst-pommes', 'Mit Pommes', 8.90, null, '/images/products/img7.jpg', 'Wurst, Curry, Pommes', 1, 1, null],
    [7, 'Chicken Nuggets', 'chicken-nuggets', '6 oder 12 Stück', 6.90, null, '/images/products/img8.jpg', 'Hähnchen, Panade', 1, 2, '[{"label":"6 Stk.","price":6.9},{"label":"12 Stk.","price":10.9}]'],
    [7, 'Chicken Wings', 'chicken-wings', '6 oder 12 Stück', 7.90, null, '/images/products/img9.jpg', 'Hähnchen', 0, 3, '[{"label":"6 Stk.","price":7.9},{"label":"12 Stk.","price":12.9}]'],
    [7, 'Chili Cheese Nuggets', 'chili-cheese-nuggets', '6 oder 12 Stück', 6.90, null, '/images/products/img7.jpg', 'Hähnchen, Chili, Käse', 0, 4, '[{"label":"6 Stk.","price":6.9},{"label":"12 Stk.","price":10.9}]'],
    [7, 'Baked Feta', 'baked-feta', '6 oder 12 Stück', 7.90, null, '/images/products/img8.jpg', 'Feta', 0, 5, '[{"label":"6 Stk.","price":7.9},{"label":"12 Stk.","price":11.9}]'],
    [7, 'Chicken Strips', 'chicken-strips', '6 oder 12 Stück', 8.50, null, '/images/products/img9.jpg', 'Hähnchen', 0, 6, '[{"label":"6 Stk.","price":8.5},{"label":"12 Stk.","price":13.9}]'],
    [7, 'Frühlingsrollen', 'fruehlingsrollen', '6 oder 12 Stück', 5.90, null, '/images/products/img7.jpg', 'Teig, Gemüse', 0, 7, '[{"label":"6 Stk.","price":5.9},{"label":"12 Stk.","price":9.9}]'],
    [7, 'Mozzarella Sticks', 'mozzarella-sticks', '6 oder 12 Stück', 6.90, null, '/images/products/img8.jpg', 'Mozzarella, Panade', 0, 8, '[{"label":"6 Stk.","price":6.9},{"label":"12 Stk.","price":11.9}]'],
    [7, 'Zwiebelringe', 'zwiebelringe', '6 oder 12 Stück', 5.50, null, '/images/products/img9.jpg', 'Zwiebeln, Panade', 0, 9, '[{"label":"6 Stk.","price":5.5},{"label":"12 Stk.","price":9.5}]'],
    [7, 'Shrimps', 'shrimps', '6 oder 12 Stück', 8.50, null, '/images/products/img7.jpg', 'Shrimps, Panade', 0, 10, '[{"label":"6 Stk.","price":8.5},{"label":"12 Stk.","price":13.9}]'],
    [7, 'Muslitos', 'muslitos', '6 oder 12 Stück', 8.50, null, '/images/products/img8.jpg', 'Muslitos, Panade', 0, 11, '[{"label":"6 Stk.","price":8.5},{"label":"12 Stk.","price":13.9}]'],
    [7, 'Corn Dog', 'corn-dog', 'Klein oder Groß', 2.99, null, '/images/products/img9.jpg', 'Würstchen, Maisteig', 0, 12, '[{"label":"Klein","price":2.99},{"label":"Groß","price":5.9}]'],
    [8, 'Coca Cola', 'coca-cola', 'Eisgekühlte Coca Cola 0,33l', 3.50, null, '/images/products/img22.jpg', null, 0, 29],
    [8, 'Fanta', 'fanta', 'Eisgekühlte Fanta 0,33l', 3.50, null, '/images/products/img23.jpg', null, 0, 30],
    [8, 'Wasser', 'wasser', 'Natürliches Mineralwasser 0,75l', 3.00, null, '/images/products/img6.jpg', null, 0, 31],
    [9, 'Frühlingsrolle', 'fruehlingsrolle', 'Knusprige Frühlingsrollen mit süß-saurer Dippsauce', 6.90, null, '/images/products/img7.jpg', null, 0, 32],
    [9, 'Falafel Wrap', 'falafel-wrap', 'Vegetarischer Wrap mit Falafel, Hummus und frischem Gemüse', 8.90, null, '/images/products/img8.jpg', null, 0, 33],
    [10, 'Knoblauch', 'knoblauch', '', 2.00, null, '/images/products/img9.jpg', '', 0, 1, null],
    [10, 'American', 'american', '', 2.00, null, '/images/products/img12.jpg', '', 0, 2, null],
    [10, 'Remoulade', 'remoulade', '', 2.00, null, '/images/products/img9.jpg', '', 0, 3, null],
    [10, 'NEXO Haus', 'nexo-haus', 'Unsere Haussauce', 2.00, null, '/images/products/img12.jpg', 'Unsere Haussauce', 1, 4, null],
    [10, 'Chili', 'chili', '', 2.00, null, '/images/products/img9.jpg', '', 0, 5, null],
    [10, 'BBQ', 'bbq-sauce', '', 2.00, null, '/images/products/img12.jpg', '', 0, 6, null],
    [10, 'Curry', 'curry', '', 2.00, null, '/images/products/img9.jpg', '', 0, 7, null],
    [11, 'Spaghetti Eis', 'spaghetti-eis', '', 5.50, null, '/images/products/img20.jpg', '', 1, 1, null],
    [11, 'Tiramisu', 'tiramisu', '', 5.50, null, '/images/products/img19.jpg', '', 0, 2, null],
    [11, 'Cheesecake', 'cheesecake', '', 5.50, null, '/images/products/img22.jpg', '', 0, 3, null],
    [11, 'Oreo Choice', 'oreo-choice', 'Oreo Donut oder Oreo Muffin, 1 nach Wahl', 3.90, null, '/images/products/img21.jpg', 'Oreo Donut oder Oreo Muffin, 1 nach Wahl', 0, 4, '[{"label":"Oreo Donut","price":3.9},{"label":"Oreo Muffin","price":3.9}]'],
    [11, 'Nutella Pizza', 'nutella-pizza', 'Nutella, Weiße Schokolade', 8.90, null, '/images/products/img19.jpg', 'Nutella, Weiße Schokolade', 1, 5, null],
    [11, 'Crêpe Nutella', 'crepe-nutella', 'Nutella, inklusive 2 Schokoladensorten nach Wahl', 7.90, null, '/images/products/img20.jpg', 'Nutella, inklusive 2 Schokoladensorten nach Wahl', 0, 6, null],
    [11, 'Crêpe Frucht', 'crepe-frucht', 'Banane, Erdbeeren oder Kiwi nach Wahl, inklusive 2 Schokoladensorten nach Wahl', 8.90, null, '/images/products/img21.jpg', 'Banane, Erdbeeren oder Kiwi nach Wahl, inklusive 2 Schokoladensorten nach Wahl', 0, 7, '[{"label":"Banane","price":8.9},{"label":"Erdbeeren","price":8.9},{"label":"Kiwi","price":8.9}]'],
    [11, 'Crêpe Lotus', 'crepe-lotus', 'Lotus, inklusive 2 Schokoladensorten nach Wahl', 8.90, null, '/images/products/img22.jpg', 'Lotus, inklusive 2 Schokoladensorten nach Wahl', 0, 8, null],
    [11, 'Crêpe Oreo', 'crepe-oreo', 'Oreo, inklusive 2 Schokoladensorten nach Wahl', 8.90, null, '/images/products/img19.jpg', 'Oreo, inklusive 2 Schokoladensorten nach Wahl', 0, 9, null],
    [11, 'Crêpe Bueno', 'crepe-bueno', 'Bueno, inklusive 2 Schokoladensorten nach Wahl', 9.50, null, '/images/products/img20.jpg', 'Bueno, inklusive 2 Schokoladensorten nach Wahl', 1, 10, null],
    [11, 'Mini Pancakes', 'mini-pancakes', '10 oder 20 Stück, 2 Toppings nach Wahl: Nutella, Weiße Schokolade, Pistaziencreme, Puderzucker', 7.90, null, '/images/products/img21.jpg', '10 oder 20 Stück, 2 Toppings nach Wahl', 1, 11, '[{"label":"10 Stück","price":7.9},{"label":"20 Stück","price":13.9}]'],
    [11, 'Mini Waffel', 'mini-waffel', '10 oder 20 Stück, 2 Toppings nach Wahl: Nutella, Weiße Schokolade, Pistaziencreme, Puderzucker', 7.90, null, '/images/products/img22.jpg', '10 oder 20 Stück, 2 Toppings nach Wahl', 0, 12, '[{"label":"10 Stück","price":7.9},{"label":"20 Stück","price":13.9}]'],
    [12, 'Portion Oliven', 'portion-oliven', '', 4.50, null, '/images/products/img4.jpg', '', 0, 1, null],
    [12, 'Portion Peperoni oder Jalapeños', 'portion-peperoni-jalapenos', '', 4.50, null, '/images/products/img5.jpg', '', 0, 2, null],
    [12, 'Knoblauchbrot mit Käse', 'knoblauchbrot', '', 6.90, null, '/images/products/img7.jpg', '', 1, 3, null],
    [12, 'Spezialbrot', 'spezialbrot', 'mit Käse überbacken', 7.50, null, '/images/products/img8.jpg', 'mit Käse überbacken', 0, 4, null],
    [12, 'Formaggi Spezialbrot', 'formaggi-spezialbrot', 'mit verschiedenen Käsesorten', 8.50, null, '/images/products/img9.jpg', 'mit verschiedenen Käsesorten', 1, 5, null],
    [13, 'Pommes Frites', 'pommes-frites', 'Groß', 5.50, null, '/images/products/img7.jpg', 'Kartoffeln', 1, 1, null],
    [13, 'Chili Cheese Fries', 'chili-cheese-fries', '', 6.90, null, '/images/products/img8.jpg', '', 0, 2, null],
    [13, 'Hotdog Fries', 'hotdog-fries', '', 8.50, null, '/images/products/img9.jpg', '', 0, 3, null],
    [13, 'Kroketten', 'kroketten', '10 Stück', 5.90, null, '/images/products/img7.jpg', 'Kartoffeln', 0, 4, null],
    [13, 'Curly Fries', 'curly-fries', '', 5.90, null, '/images/products/img8.jpg', '', 0, 5, null],
    [14, 'BOX 1', 'box-1', '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 38.90, null, '/images/products/img16.jpg', '2 Cheeseburger oder 2 Chickenburger, 6 Chicken Nuggets, 6 Chicken Wings, Pommes, 3 Saucen', 1, 1, null],
    [14, 'BOX 2', 'box-2', 'Pizza Wunsch Ø 30 cm, 2 Cheeseburger oder 2 Chickenburger, 6 Snacks nach Wahl, Pommes, 3 Saucen', 49.90, null, '/images/products/img17.jpg', 'Pizza Wunsch, Cheeseburger oder Chickenburger, Snacks, Pommes, Saucen', 0, 2, null],
    [14, 'BOX 3', 'box-3', 'Pizza Wunsch Ø 30 cm, 1 Cheeseburger oder 1 Chickenburger, Pasta Wunsch, Pommes, 2 Saucen', 38.90, null, '/images/products/img18.jpg', 'Pizza Wunsch, Cheeseburger oder Chickenburger, Pasta Wunsch, Pommes, Saucen', 0, 3, null],
    [15, 'Kids Pizza', 'kids-pizza', 'Pizza Ø 22 cm – bitte wählen: Margherita oder Salami', 7.90, null, '/images/products/img1.jpg', 'Pizza, Margherita oder Salami', 1, 1, '[{"label":"Margherita","price":7.9},{"label":"Salami","price":7.9}]'],
    [15, 'Kids Nuggets', 'kids-nuggets', '5 Chicken Nuggets, Pommes', 7.50, null, '/images/products/img8.jpg', 'Chicken Nuggets, Pommes', 0, 2, null],
    [15, 'Happy Fish', 'happy-fish', '4 Happy Fish, Pommes', 7.90, null, '/images/products/img9.jpg', 'Fisch, Pommes', 0, 3, null],
    [16, 'Vanille', 'vanille', '', 5.99, null, '/images/products/img22.jpg', '', 0, 1, null],
    [16, 'Schokolade', 'schokolade', '', 5.99, null, '/images/products/img22.jpg', '', 0, 2, null],
    [16, 'Banane', 'banane', '', 5.99, null, '/images/products/img22.jpg', '', 0, 3, null],
    [16, 'Erdbeere', 'erdbeere', '', 5.99, null, '/images/products/img22.jpg', '', 0, 4, null],
    [16, 'Mix Milkshake', 'mix-milkshake', '2 Sorten nach Wahl gemischt', 6.49, null, '/images/products/img22.jpg', '2 Sorten nach Wahl gemischt', 1, 5, null]
  ];

  try {
    await db.run('DELETE FROM products');
    await db.run('DELETE FROM categories');

    for (const c of categories) {
      await db.run('INSERT INTO categories (name, slug, description, sort_order) VALUES ($1, $2, $3, $4)', c);
    }

    for (const p of products) {
      await db.run('INSERT INTO products (category_id, name, slug, description, price, old_price, image, ingredients, is_featured, sort_order, sizes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10] || null]);
    }

    await db.run("UPDATE settings SET value = $1 WHERE key = $2", ['Ammaya', 'site_name']);
    await db.run("UPDATE settings SET value = $1 WHERE key = $2", ['Ihr Restaurant für Pizza, Burger und mehr', 'site_description']);

    console.log('Seed erfolgreich abgeschlossen!');
    console.log('Kategorien: ' + categories.length);
    console.log('Produkte: ' + products.length);
  } catch (e) {
    console.error('Fehler beim Seed:', e.message);
  }
}

seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
