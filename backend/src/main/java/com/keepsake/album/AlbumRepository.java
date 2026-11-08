package com.keepsake.album;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

/** Every lookup here leaves out deleted albums, which are kept but never shown. */
public interface AlbumRepository extends JpaRepository<Album, UUID> {

    List<Album> findByOwnerIdAndDeletedAtIsNullOrderByUpdatedAtDesc(UUID ownerId);

    List<Album> findByOwnerIdAndCategoryAndDeletedAtIsNullOrderByUpdatedAtDesc(UUID ownerId, AlbumCategory category);

    Optional<Album> findByIdAndOwnerIdAndDeletedAtIsNull(UUID id, UUID ownerId);

    /** Holds the album while its photos change, so that two requests can't take the same place. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Album a where a.id = :id and a.ownerId = :ownerId and a.deletedAt is null")
    Optional<Album> lockByIdAndOwnerId(UUID id, UUID ownerId);
}
