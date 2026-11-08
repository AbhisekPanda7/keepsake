package com.keepsake.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class RequiredSettingsCheckTest {

    private static final String GOOD_SECRET = "x".repeat(32);

    private static void check(String secret, String password) {
        RequiredSettingsCheck.check(new MockEnvironment()
                .withProperty("keepsake.jwt.secret", secret)
                .withProperty("spring.datasource.password", password));
    }

    @Test
    void aMissingOrWeakSecretStopsStartupAndSaysWhich() {
        for (String bad : new String[] {"", "too-short"}) {
            String message = assertThrows(IllegalStateException.class, () -> check(bad, "pw")).getMessage();
            assertTrue(message.contains("JWT_SECRET"), message);
        }
    }

    @Test
    void aMissingDatabasePasswordStopsStartupBeforeAnyConnection() {
        String message = assertThrows(IllegalStateException.class, () -> check(GOOD_SECRET, "")).getMessage();
        assertTrue(message.contains("DATABASE_PASSWORD"), message);
    }

    @Test
    void completeSettingsPass() {
        assertDoesNotThrow(() -> check(GOOD_SECRET, "pw"));
    }

    @Test
    void aMistypedEmailServiceStopsStartupAndSaysWhich() {
        for (String good : new String[] {"none", "brevo", "outbox", ""}) {
            assertDoesNotThrow(() -> RequiredSettingsCheck.check(new MockEnvironment()
                    .withProperty("keepsake.jwt.secret", GOOD_SECRET)
                    .withProperty("spring.datasource.password", "pw")
                    .withProperty("keepsake.mail.type", good)), good);
        }
        String message = assertThrows(IllegalStateException.class, () -> RequiredSettingsCheck.check(new MockEnvironment()
                .withProperty("keepsake.jwt.secret", GOOD_SECRET)
                .withProperty("spring.datasource.password", "pw")
                .withProperty("keepsake.mail.type", "brevoo"))).getMessage();
        assertTrue(message.contains("MAIL_TYPE"), message);
    }
}
