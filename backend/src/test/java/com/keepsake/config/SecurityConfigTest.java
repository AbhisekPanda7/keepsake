package com.keepsake.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SecurityConfigTest {

    private static KeepsakeProperties withSecret(String secret) {
        return new KeepsakeProperties(new KeepsakeProperties.Jwt(secret, 1), null, null, null);
    }

    @Test
    void aWeakSigningSecretStopsTheAppFromStarting() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> new SecurityConfig().jwtKey(withSecret("too-short")));
        assertTrue(e.getMessage().contains("JWT_SECRET"));
    }

    @Test
    void aLongEnoughSecretIsAccepted() {
        assertDoesNotThrow(() -> new SecurityConfig().jwtKey(withSecret("x".repeat(32))));
    }
}
