package com.keepsake.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {

    @Id
    public UUID id;

    @Column(nullable = false, unique = true)
    public String email;

    @Column(name = "password_hash", nullable = false)
    public String passwordHash;

    @Column(name = "display_name", nullable = false)
    public String displayName;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;
}
