-- Deleting in the app hides an album or photograph instead of erasing it. The row and its
-- stored image stay; deleted_at records when it was hidden. Nothing in the API returns
-- a row that has one.

ALTER TABLE albums ADD COLUMN deleted_at timestamptz;
ALTER TABLE photos ADD COLUMN deleted_at timestamptz;

-- The library lists only albums that are still there.
DROP INDEX albums_by_owner;
CREATE INDEX albums_by_owner ON albums (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
