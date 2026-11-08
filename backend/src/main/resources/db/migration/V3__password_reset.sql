-- Forgotten passwords. A reset link carries a long random code; only its SHA-256 hash is
-- stored here, so the table alone can't be used to reset anyone's password. Each code
-- belongs to one person, lasts a short while, and works once.

CREATE TABLE password_reset_tokens (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    -- Set when the code is used, or when a newer one replaces it.
    used_at    timestamptz
);

CREATE INDEX password_reset_tokens_by_user ON password_reset_tokens (user_id);

-- Carried in every sign-in token. Changing the password raises it, which ends every
-- sign-in made before. Existing accounts start at 0, which their current tokens match.
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
