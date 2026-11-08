package com.keepsake.auth;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    @Query("select u.sessionVersion from User u where u.id = :id")
    Optional<Integer> findSessionVersion(UUID id);
}
