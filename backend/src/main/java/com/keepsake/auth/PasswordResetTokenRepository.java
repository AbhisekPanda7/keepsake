package com.keepsake.auth;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    /** Held while the password changes, so that the same link can't be used twice at once. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from PasswordResetToken t where t.tokenHash = :tokenHash")
    Optional<PasswordResetToken> lockByTokenHash(String tokenHash);

    /** Ends every link this person still has, when a newer one is sent or one is used. */
    @Modifying
    @Query("update PasswordResetToken t set t.usedAt = :now where t.userId = :userId and t.usedAt is null")
    int retireAll(UUID userId, Instant now);

    /** Links that can no longer work are of no use to anyone, so they're cleared away. */
    @Modifying
    @Query("delete from PasswordResetToken t where t.userId = :userId and (t.usedAt is not null or t.expiresAt < :now)")
    int deleteFinished(UUID userId, Instant now);
}
