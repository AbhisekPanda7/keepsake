package com.keepsake.album;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "albums")
public class Album {

    @Id
    public UUID id;

    @Column(name = "owner_id", nullable = false)
    public UUID ownerId;

    @Column(nullable = false)
    public String title;

    @Column(nullable = false)
    public String description;

    @Column(name = "theme_colour", nullable = false)
    public String themeColour;

    @Column(name = "theme_material", nullable = false)
    public String themeMaterial;

    @Column(name = "theme_paper", nullable = false)
    public String themePaper;

    /** Which collection of the library it's kept in. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public AlbumCategory category = AlbumCategory.DEFAULT;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    /** When it was deleted in the app. It's kept, but nothing in the API shows it any more. */
    @Column(name = "deleted_at")
    public Instant deletedAt;
}
