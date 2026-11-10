ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'shawarma';
ALTER TABLE products ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN price_label TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN previous_price_label TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN online_orderable INTEGER NOT NULL DEFAULT 1 CHECK (online_orderable IN (0, 1));
ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE products SET
  category = 'shawarma',
  description = CASE id
    WHEN 'chicken-shawarma' THEN 'Spicy chicken, cabbage, lettuce, carrots, juicy spicy sauce.'
    WHEN 'sausage-shawarma' THEN 'Sausage, fried eggs, cabbage, carrots, lettuce, spicy and juicy sauce.'
    WHEN 'beef-shawarma' THEN 'Beef, sausage, fried eggs, cabbage, carrots, lettuce, spicy and juicy sauce.'
    WHEN 'mixed-shawarma' THEN 'Spicy beef and chicken, cabbage, onion, lettuce, carrots, garlic and shawarma sauce.'
    WHEN 'loaded-shawarma' THEN 'Chicken or beef, sausage, fried eggs, cabbage, carrots, lettuce, spicy and juicy sauce.'
    WHEN 'ultimate-shawarma' THEN 'Chicken and beef, cheese, French fries, sausage, fried egg, spicy and shawarma sauce.'
    ELSE description
  END,
  price_label = CASE id
    WHEN 'chicken-shawarma' THEN 'GH₵40'
    WHEN 'sausage-shawarma' THEN 'GH₵40'
    WHEN 'beef-shawarma' THEN 'GH₵50'
    WHEN 'mixed-shawarma' THEN 'GH₵60'
    WHEN 'loaded-shawarma' THEN 'GH₵80'
    WHEN 'ultimate-shawarma' THEN 'GH₵100'
    WHEN 'loaded-fries-chicken' THEN 'GH₵80'
    WHEN 'loaded-fries-mix-combo' THEN 'GH₵100'
    ELSE price_label
  END,
  previous_price_label = CASE id
    WHEN 'chicken-shawarma' THEN 'GH₵50'
    WHEN 'sausage-shawarma' THEN 'GH₵50'
    WHEN 'beef-shawarma' THEN 'GH₵60'
    WHEN 'mixed-shawarma' THEN 'GH₵70'
    WHEN 'loaded-shawarma' THEN 'GH₵90'
    WHEN 'ultimate-shawarma' THEN 'GH₵110'
    WHEN 'loaded-fries-chicken' THEN 'GH₵90'
    WHEN 'loaded-fries-mix-combo' THEN 'GH₵110'
    ELSE previous_price_label
  END,
  image_url = CASE id
    WHEN 'chicken-shawarma' THEN '/images/Chicken-Shawarma.jpeg'
    WHEN 'sausage-shawarma' THEN '/images/Sausage-Shawarma.jpeg'
    WHEN 'beef-shawarma' THEN '/images/Beef-Shawarma.jpeg'
    WHEN 'mixed-shawarma' THEN '/images/Mixed-Shawarma.jpeg'
    WHEN 'loaded-shawarma' THEN '/images/Loaded-Shawarma.jpeg'
    WHEN 'ultimate-shawarma' THEN '/images/Ultimate-Shawarma.jpeg'
    WHEN 'loaded-fries-chicken' THEN '/images/loaded-fries-chicken.jpg'
    WHEN 'loaded-fries-mix-combo' THEN '/images/loaded-fries-mix-combo.jpg'
    ELSE image_url
  END,
  sort_order = CASE id
    WHEN 'chicken-shawarma' THEN 10
    WHEN 'sausage-shawarma' THEN 20
    WHEN 'beef-shawarma' THEN 30
    WHEN 'mixed-shawarma' THEN 40
    WHEN 'loaded-shawarma' THEN 50
    WHEN 'ultimate-shawarma' THEN 60
    WHEN 'loaded-fries-chicken' THEN 10
    WHEN 'loaded-fries-mix-combo' THEN 20
    ELSE 100
  END;

INSERT INTO products
  (id, name, price_pesewas, active, category, description, price_label, previous_price_label, image_url, online_orderable, sort_order)
VALUES
  ('6-inch-cake', '6 Inch Cake', 1, 1, 'cakes', 'Suitable for 6–10 people.', 'GH₵250–350', 'GH₵260–360', '/images/cake-6-inch.jpeg', 0, 10),
  ('8-inch-cake', '8 Inch Cake', 1, 1, 'cakes', 'Suitable for 10–15 people.', 'GH₵350–450', 'GH₵360–460', '/images/cake-8-inch.jpeg', 0, 20),
  ('10-inch-cake', '10 Inch Cake', 1, 1, 'cakes', 'Suitable for 15–25 people.', 'GH₵450–600', 'GH₵460–610', '/images/cake-10-inch.jpeg', 0, 30),
  ('12-inch-cake', '12 Inch Cake', 1, 1, 'cakes', 'Suitable for 25–40 people.', 'GH₵600–800', 'GH₵610–810', '/images/cake-12-inch.jpeg', 0, 40),
  ('2-tier-wedding-cake', '2-Tier Wedding Cake', 1, 1, 'wedding-cakes', '', 'GH₵800–1,200', 'GH₵810–1,210', '/images/wedding-cake-2-tier.jpeg', 0, 10),
  ('3-tier-wedding-cake', '3-Tier Wedding Cake', 1, 1, 'wedding-cakes', '', 'GH₵1,200–1,800', 'GH₵1,210–1,810', '/images/wedding-cake-3-tier.jpeg', 0, 20),
  ('4-tier-wedding-cake', '4-Tier Wedding Cake', 1, 1, 'wedding-cakes', '', 'GH₵1,800–2,400', 'GH₵1,810–2,410', '/images/wedding-cake-4-tier.jpeg', 0, 30),
  ('5-tier-wedding-cake', '5-Tier Wedding Cake', 1, 1, 'wedding-cakes', '', 'GH₵2,400–3,000', 'GH₵2,410–3,010', '/images/wedding-cake-5-tier.jpeg', 0, 40);

CREATE TABLE news_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  publish_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO news_posts (id, title, body, image_url, publish_at, created_at, updated_at)
VALUES (
  'pop-up-experience',
  'POP UP Experience',
  'Meet us for a special celebration!',
  '/images/news-1.jpeg',
  '2026-10-31T00:00:00.000Z',
  '2026-10-31T00:00:00.000Z',
  '2026-10-31T00:00:00.000Z'
);

INSERT INTO news_posts (id, title, body, image_url, publish_at, created_at, updated_at)
VALUES (
  'valentines-day-promo',
  'Vals Day Promo',
  'Celebrate your love ones with us',
  '/images/news-2.jpg',
  '2026-02-14T00:00:00.000Z',
  '2026-02-14T00:00:00.000Z',
  '2026-02-14T00:00:00.000Z'
);

INSERT INTO news_posts (id, title, body, image_url, publish_at, created_at, updated_at)
VALUES (
  'placeholder-promo-draft',
  'Placeholder headline about a promo or combo deal',
  'Placeholder body text describing the promo — replace with your own update.',
  '/images/news-3.jpg',
  NULL,
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

CREATE TABLE site_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);

INSERT INTO site_settings (setting_key, setting_value) VALUES
  ('homepage_headline', 'Welcome to De 5th Bite'),
  ('homepage_tagline', 'Fuel your night with the best shawarma and loaded fries in town.'),
  ('business_hours', 'Opened daily'),
  ('whatsapp_phone', '233248451683'),
  ('contact_phone', '059 527 2224'),
  ('contact_email', 'de5thbite26@gmail.com'),
  ('business_location', 'XZ Residence, Accra');
