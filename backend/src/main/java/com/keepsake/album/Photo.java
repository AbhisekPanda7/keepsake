package com.keepsake.album;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "photos")
public class Photo {

    @Id
    public UUID id;

    @Column(name = "album_id", nullable = false)
    public UUID albumId;

    /** The photograph's place within its own album. */
    @Column(nullable = false)
    public int position;

    @Column(nullable = false)
    public String name;

    @Column(nullable = false)
    public int width;

    @Column(nullable = false)
    public int height;

    /** Milliseconds since 1970, as in the frontend. Null if the photo has no usable date. */
    @Column(name = "taken_at")
    public Long takenAt;

    /** "exif" or "file": whether that date came from the camera or the file. */
    @Column(name = "taken_at_source")
    public String takenAtSource;

    @Column(nullable = false)
    public String caption;

    @Column(name = "storage_key", nullable = false)
    public String storageKey;

    @Column(name = "content_type", nullable = false)
    public String contentType;

    @Column(name = "size_bytes", nullable = false)
    public long sizeBytes;

    @Column(name = "added_at", nullable = false)
    public Instant addedAt;

    /**
     * When it was removed in the app. It's kept, with its image, but nothing in the API shows it
     * any more. A removed photo moves to a negative position, out of the way of the others.
     */
    @Column(name = "deleted_at")
    public Instant deletedAt;
}
