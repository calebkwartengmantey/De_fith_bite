ALTER TABLE order_reviews
ADD COLUMN public_consent INTEGER NOT NULL DEFAULT 0 CHECK (public_consent IN (0, 1));
