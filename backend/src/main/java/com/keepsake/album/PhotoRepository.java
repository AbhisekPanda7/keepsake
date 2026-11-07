package com.keepsake.album;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** Every lookup here leaves out deleted photographs and those in deleted albums. */
public interface PhotoRepository extends JpaRepository<Photo, UUID> {

    List<Photo> findByAlbumIdAndDeletedAtIsNullOrderByPosition(UUID albumId);

    /** Finds a photo only if it's in an album belonging to this person. */
    @Query("select p from Photo p where p.id = :id and p.deletedAt is null"
            + " and p.albumId in (select a.id from Album a where a.ownerId = :ownerId and a.deletedAt is null)")
    Optional<Photo> findOwned(UUID id, UUID ownerId);

    /** Counts deleted photos too, since they keep their rows. */
    @Query("select coalesce(max(p.position), -1) from Photo p where p.albumId = :albumId")
    int lastPosition(UUID albumId);

    /** The lowest position in use, deleted photos included. */
    @Query("select coalesce(min(p.position), 0) from Photo p where p.albumId = :albumId")
    int firstPosition(UUID albumId);

    @Query("select p.albumId, count(p) from Photo p where p.albumId in :albumIds and p.deletedAt is null group by p.albumId")
    List<Object[]> countByAlbum(Collection<UUID> albumIds);

    /** Deleted photographs don't count against someone's allowance. */
    @Query("select coalesce(sum(p.sizeBytes), 0) from Photo p where p.deletedAt is null"
            + " and p.albumId in (select a.id from Album a where a.ownerId = :ownerId and a.deletedAt is null)")
    long totalBytes(UUID ownerId);
}
