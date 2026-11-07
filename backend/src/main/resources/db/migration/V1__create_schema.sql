-- Mirrors the frontend's IndexedDB model, with users and object storage added.

CREATE TABLE users (
    id            uuid PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    display_name  text NOT NULL,
    created_at    timestamptz NOT NULL
);

CREATE TABLE albums (
    id             uuid PRIMARY KEY,
    owner_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title          text NOT NULL,
    description    text NOT NULL,
    theme_colour   text NOT NULL,
    theme_material text NOT NULL,
    theme_paper    text NOT NULL,
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL
);

CREATE INDEX albums_by_owner ON albums (owner_id, updated_at DESC);

CREATE TABLE photos (
    id              uuid PRIMARY KEY,
    album_id        uuid NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
    position        integer NOT NULL,
    name            text NOT NULL,
    width           integer NOT NULL,
    height          integer NOT NULL,
    taken_at        bigint,
    taken_at_source text,
    caption         text NOT NULL,
    storage_key     text NOT NULL,
    content_type    text NOT NULL,
    size_bytes      bigint NOT NULL,
    added_at        timestamptz NOT NULL,
    -- Checked at commit, so that a reorder can pass through overlapping positions.
    CONSTRAINT photos_position_per_album UNIQUE (album_id, position) DEFERRABLE INITIALLY DEFERRED
);
