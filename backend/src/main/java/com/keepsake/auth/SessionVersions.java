package com.keepsake.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Each person's current session version, which every request's sign-in token must match.
 * Remembered for a minute, so that a page of photographs doesn't ask the database once per
 * image; a password reset forgets it at once. One server is assumed: with several, another
 * one could accept an old sign-in for up to that minute.
 */
@Component
public class SessionVersions {

    private static final Duration REMEMBER = Duration.ofSeconds(60);
    private static final int MAX_REMEMBERED = 10_000;

    private record Known(int version, Instant at) {}

    private final UserRepository users;
    private final Clock clock;
    private final Map<UUID, Known> known = new ConcurrentHashMap<>();

    @Autowired
    public SessionVersions(UserRepository users) {
        this(users, Clock.systemUTC());
    }

    SessionVersions(UserRepository users, Clock clock) {
        this.users = users;
        this.clock = clock;
    }

    /** Null if there's no such person, whose tokens are then worthless. */
    public Integer current(UUID userId) {
        Instant now = clock.instant();
        Known seen = known.get(userId);
        if (seen != null && seen.at().plus(REMEMBER).isAfter(now)) return seen.version();
        Integer version = users.findSessionVersion(userId).orElse(null);
        if (version == null) {
            known.remove(userId);
            return null;
        }
        if (known.size() >= MAX_REMEMBERED) known.clear();
        known.put(userId, new Known(version, now));
        return version;
    }

    public void forget(UUID userId) {
        known.remove(userId);
    }
}
