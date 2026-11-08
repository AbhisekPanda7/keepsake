package com.keepsake.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Allows at most `max` events per key within a window that starts at the first of them.
 * Held in memory, which suits a single server, and bounded, so that a flood of invented
 * keys can't fill the server's memory.
 */
final class AttemptLimiter {

    private static final int MAX_TRACKED = 10_000;

    private record Window(int count, Instant start) {}

    private final int max;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    AttemptLimiter(int max, Duration window, Clock clock) {
        this.max = max;
        this.window = window;
        this.clock = clock;
    }

    /** Whether the key has used up its allowance, without counting anything. */
    boolean isBlocked(String key) {
        Window seen = current(key);
        return seen != null && seen.count() >= max;
    }

    /** Counts one event, and says whether it was within the allowance. */
    boolean tryAcquire(String key) {
        if (isBlocked(key)) return false;
        record(key);
        return true;
    }

    void record(String key) {
        Instant now = clock.instant();
        if (windows.size() >= MAX_TRACKED) {
            windows.values().removeIf(w -> !w.start().plus(window).isAfter(now));
            if (windows.size() >= MAX_TRACKED) windows.clear();
        }
        windows.merge(key, new Window(1, now), (old, fresh) ->
                old.start().plus(window).isAfter(now) ? new Window(old.count() + 1, old.start()) : fresh);
    }

    private Window current(String key) {
        Window seen = windows.get(key);
        if (seen == null) return null;
        if (!seen.start().plus(window).isAfter(clock.instant())) {
            windows.remove(key, seen);
            return null;
        }
        return seen;
    }
}
