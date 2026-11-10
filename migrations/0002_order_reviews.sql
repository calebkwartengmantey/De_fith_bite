CREATE TABLE order_reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL CHECK (length(review_text) BETWEEN 2 AND 1000),
  created_at TEXT NOT NULL
);

CREATE INDEX order_reviews_created ON order_reviews(created_at DESC);
