package com.keepsake.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Slows password guessing. Counted per email and address together, so that someone
 * guessing can't lock the real owner out from elsewhere. Held in memory, which suits a
 * single server; running several would need this moved somewhere shared.
 */
@Component
public class LoginThrottle {

    static final int MAX_FAILURES = 8;
    private static final Duration WINDOW = Duration.ofMinutes(15);
    private static final int MAX_TRACKED = 10_000;

    private record Attempts(int failures, Instant firstFailure) {}

    private final Map<String, Attempts> attempts = new ConcurrentHashMap<>();

    public boolean isBlocked(String email, String address) {
        Attempts seen = attempts.get(key(email, address));
        if (seen == null) return false;
        if (seen.firstFailure().plus(WINDOW).isBefore(Instant.now())) {
            attempts.remove(key(email, address));
            return false;
        }
        return seen.failures() >= MAX_FAILURES;
    }

    public void recordFailure(String email, String address) {
        // Bounded, so that a flood of invented emails can't fill the server's memory.
        if (attempts.size() >= MAX_TRACKED) {
            Instant cutoff = Instant.now().minus(WINDOW);
            attempts.values().removeIf(a -> a.firstFailure().isBefore(cutoff));
            if (attempts.size() >= MAX_TRACKED) attempts.clear();
        }
        attempts.merge(key(email, address), new Attempts(1, Instant.now()),
                (old, fresh) -> new Attempts(old.failures() + 1, old.firstFailure()));
    }

    public void recordSuccess(String email, String address) {
        attempts.remove(key(email, address));
    }

    private static String key(String email, String address) {
        return email + "|" + address;
    }
}
