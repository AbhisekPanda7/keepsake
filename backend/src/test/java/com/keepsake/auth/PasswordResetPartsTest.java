package com.keepsake.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.keepsake.mail.EmailMessage;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The small parts of password reset, without a server or a database. */
class PasswordResetPartsTest {

    /** A clock the test moves by hand. */
    private static final class TestClock extends Clock {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    void reasonablePasswordsPass() {
        for (String good : List.of("correct horse", "a brand new 2nd password", "Tr0ub4dor&3", "पासवर्ड 2026", "12345 apples")) {
            assertNull(PasswordRules.problem(good), good);
        }
    }

    @Test
    void weakPasswordsAreExplained() {
        assertTrue(PasswordRules.problem("short1").contains("at least 8"));
        assertTrue(PasswordRules.problem("x".repeat(73)).contains("too long"));
        assertTrue(PasswordRules.problem("é".repeat(37)).contains("too long"), "counted in bytes, as BCrypt does");
        assertTrue(PasswordRules.problem("aaaaaaaaaa").contains("repeated"));
        assertTrue(PasswordRules.problem("          ").contains("repeated"));
        assertTrue(PasswordRules.problem("Password123").contains("easy to guess"));
        assertTrue(PasswordRules.problem("onlyletters").contains("mix"));
        assertTrue(PasswordRules.problem("1234567890123").contains("mix"));
        assertNotNull(PasswordRules.problem(null));
    }

    @Test
    void aLimiterAllowsItsShareThenWaitsForTheWindowToPass() {
        TestClock clock = new TestClock();
        AttemptLimiter limiter = new AttemptLimiter(3, Duration.ofMinutes(15), clock);
        assertTrue(limiter.tryAcquire("a"));
        assertTrue(limiter.tryAcquire("a"));
        assertTrue(limiter.tryAcquire("a"));
        assertFalse(limiter.tryAcquire("a"));
        assertTrue(limiter.tryAcquire("b"), "each key has its own allowance");
        clock.now = clock.now.plus(Duration.ofMinutes(14));
        assertTrue(limiter.isBlocked("a"));
        clock.now = clock.now.plus(Duration.ofMinutes(1));
        assertFalse(limiter.isBlocked("a"), "a fresh window after 15 minutes");
        assertTrue(limiter.tryAcquire("a"));
    }

    @Test
    void theEmailCarriesTheLinkAndCantBeUsedToInjectHtml() {
        EmailMessage message = PasswordResetMailer.compose("a@example.com", "<b>Sam</b>", "https://site.example/reset-password#token=abc", 30);
        assertEquals("a@example.com", message.to());
        assertEquals("Reset your Keepsake password", message.subject());
        assertTrue(message.text().contains("https://site.example/reset-password#token=abc"));
        assertTrue(message.text().contains("30 minutes"));
        assertTrue(message.html().contains("href=\"https://site.example/reset-password#token=abc\""));
        assertFalse(message.html().contains("<b>Sam</b>"), "a name is shown as text, never as HTML");
        assertTrue(message.html().contains("&lt;b&gt;Sam&lt;/b&gt;"));
    }

    @Test
    void codesAreHashedTheSameWayEveryTime() {
        String hash = PasswordResetService.hash("abc");
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hash, "SHA-256, as hex");
        assertEquals(hash, PasswordResetService.hash("abc"));
    }
}
