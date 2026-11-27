ALTER TABLE news_posts
ADD COLUMN show_on_homepage INTEGER NOT NULL DEFAULT 0 CHECK (show_on_homepage IN (0, 1));
