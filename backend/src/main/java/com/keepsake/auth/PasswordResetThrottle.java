package com.keepsake.auth;

import java.time.Clock;
import java.time.Duration;
import org.springframework.stereotype.Component;

/**
 * Limits on the forgotten-password requests, which anyone can make without signing in.
 *  - Asking for links: a few per email, so that nobody's inbox can be flooded, and more per
 *    network address, so that one machine can't work through a list of addresses.
 *  - Using links: wrong codes are counted per address. A code is 256 random bits, so it
 *    can't be guessed anyway; this stops anyone wasting the server's time trying.
 */
@Component
public class PasswordResetThrottle {

    static final int REQUESTS_PER_EMAIL = 3;
    static final int REQUESTS_PER_ADDRESS = 10;
    static final int BAD_CODES_PER_ADDRESS = 20;

    private final AttemptLimiter perEmail;
    private final AttemptLimiter perAddress;
    private final AttemptLimiter badCodes;

    public PasswordResetThrottle() {
        this(Clock.systemUTC());
    }

    PasswordResetThrottle(Clock clock) {
        perEmail = new AttemptLimiter(REQUESTS_PER_EMAIL, Duration.ofMinutes(30), clock);
        perAddress = new AttemptLimiter(REQUESTS_PER_ADDRESS, Duration.ofMinutes(15), clock);
        badCodes = new AttemptLimiter(BAD_CODES_PER_ADDRESS, Duration.ofMinutes(15), clock);
    }

    boolean allowRequestFrom(String address) {
        return perAddress.tryAcquire(address);
    }

    boolean allowRequestFor(String email) {
        return perEmail.tryAcquire(email);
    }

    boolean tooManyBadCodes(String address) {
        return badCodes.isBlocked(address);
    }

    void recordBadCode(String address) {
        badCodes.record(address);
    }
}
