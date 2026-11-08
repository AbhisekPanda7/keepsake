package com.keepsake.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** One reset link. Only the hash of its code is kept; the code itself is only ever emailed. */
@Entity
@Table(name = "password_reset_tokens")
public class PasswordResetToken {

    @Id
    public UUID id;

    @Column(name = "user_id", nullable = false)
    public UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true)
    public String tokenHash;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    public Instant expiresAt;

    /** When it was used, or replaced by a newer link. A used link never works again. */
    @Column(name = "used_at")
    public Instant usedAt;
}
