-- Each album belongs to one of two collections in the library. Every existing album
-- becomes INDIVIDUAL, and so does any new one that doesn't say otherwise. Adding a column
-- with a fixed default leaves the existing rows, their photographs and ids untouched.

ALTER TABLE albums ADD COLUMN category text NOT NULL DEFAULT 'INDIVIDUAL';
ALTER TABLE albums ADD CONSTRAINT albums_category_known CHECK (category IN ('INDIVIDUAL', 'COUPLE'));
