package com.keepsake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.web.servlet.ResultActions;

/** Forgotten passwords, from asking for a link to signing in with the new password. */
@ExtendWith(OutputCaptureExtension.class)
class PasswordResetApiTest extends ApiTestSupport {

    /** These tests count albums exactly; StarterAlbumApiTest covers the album new accounts get. */
    @DynamicPropertySource
    static void withoutStarterAlbum(DynamicPropertyRegistry registry) {
        registry.add("keepsake.starter-album", () -> "false");
    }

    private static final Pattern LINK = Pattern.compile("https://album\\.example/reset-password#token=([A-Za-z0-9_-]{43})");
    private static final String NEW_PASSWORD = "a brand new 2nd password";

    @Autowired JwtEncoder jwtEncoder;

    // ---- helpers ----------------------------------------------------------------------

    private ResultActions requestReset(String email, String address) throws Exception {
        return postJson("/api/auth/password-reset", Map.of("email", email), address);
    }

    private ResultActions check(String code, String address) throws Exception {
        return postJson("/api/auth/password-reset/check", Map.of("token", code), address);
    }

    private ResultActions confirm(String code, String password, String again, String address) throws Exception {
        return postJson("/api/auth/password-reset/confirm",
                Map.of("token", code, "password", password, "confirmPassword", again), address);
    }

    private List<String> emailsTo(String email) throws IOException {
        try (Stream<Path> files = Files.list(OUTBOX_DIR)) {
            return files.sorted().map(PasswordResetApiTest::read).filter(text -> text.startsWith("To: " + email + "\n")).toList();
        }
    }

    private static String read(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Emails are sent in the background, so this waits for the next one to arrive. */
    private String awaitCode(String email, int alreadySent) throws Exception {
        for (int i = 0; i < 100; i += 1) {
            List<String> emails = emailsTo(email);
            if (emails.size() > alreadySent) {
                Matcher link = LINK.matcher(emails.get(emails.size() - 1));
                assertTrue(link.find(), "the email holds a link to the website");
                return link.group(1);
            }
            Thread.sleep(50);
        }
        throw new AssertionError("no email arrived for " + email);
    }

    /** Asks for a link for this email and returns the code in it. */
    private String resetCode(String email) throws Exception {
        int before = emailsTo(email).size();
        requestReset(email, newAddress()).andExpect(status().isAccepted());
        return awaitCode(email, before);
    }

    private static String sha256(String text) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    }

    // ---- asking for a link ---------------------------------------------------------------

    @Test
    void aKnownAndAnUnknownEmailGetTheSameAnswer() throws Exception {
        String known = newEmail();
        register(known, "correct horse");
        String unknown = newEmail();

        JsonNode forKnown = body(requestReset(known.toUpperCase(), newAddress()).andExpect(status().isAccepted()));
        JsonNode forUnknown = body(requestReset(unknown, newAddress()).andExpect(status().isAccepted()));
        assertEquals(forKnown, forUnknown, "nothing in the answer says whether there's an account");
        assertTrue(forKnown.get("message").asText().contains("30 minutes"));

        awaitCode(known, 0);
        Thread.sleep(300);
        assertEquals(0, emailsTo(unknown).size(), "no email goes to an address without an account");
    }

    @Test
    void theEmailHasAWorkingLinkAndTheDatabaseOnlyItsHash() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);

        String userId = jdbc.queryForObject("select id::text from keepsake.users where email = ?", String.class, email);
        Map<String, Object> row = jdbc.queryForMap(
                "select token_hash, created_at, expires_at, used_at from keepsake.password_reset_tokens where user_id = ?::uuid", userId);
        assertNotEquals(code, row.get("token_hash"), "the code itself is never stored");
        assertEquals(sha256(code), row.get("token_hash"));
        assertEquals(null, row.get("used_at"));
        Instant created = ((java.sql.Timestamp) row.get("created_at")).toInstant();
        Instant expires = ((java.sql.Timestamp) row.get("expires_at")).toInstant();
        assertEquals(30 * 60, expires.getEpochSecond() - created.getEpochSecond(), "lasts 30 minutes");

        String text = emailsTo(email).get(0);
        assertTrue(text.contains("Subject: Reset your Keepsake password"));
        assertFalse(text.contains("correct horse"), "the password is never in the email");
    }

    @Test
    void aNewerLinkReplacesTheOlderOne() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String first = resetCode(email);
        String second = resetCode(email);
        assertNotEquals(first, second);
        check(first, newAddress()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_invalid"));
        check(second, newAddress()).andExpect(status().isOk()).andExpect(jsonPath("$.expiresAt").isNumber());
    }

    // ---- using it ----------------------------------------------------------------------

    @Test
    void theNewPasswordWorksAndTheOldOneNoLonger() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);

        long expiresAt = body(check(code, newAddress()).andExpect(status().isOk())).get("expiresAt").asLong();
        assertTrue(expiresAt > System.currentTimeMillis() + 29 * 60_000L);
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());

        login(email, "correct horse").andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("bad_credentials"));
        String token = body(login(email, NEW_PASSWORD).andExpect(status().isOk())).get("token").asText();
        mvc.perform(get("/api/auth/me").header("Authorization", bearer(token))).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email));

        String stored = jdbc.queryForObject("select password_hash from keepsake.users where email = ?", String.class, email);
        assertTrue(stored.startsWith("$2"), "still a BCrypt hash");
        assertFalse(stored.contains(NEW_PASSWORD));
    }

    @Test
    void resettingEndsEverySignInMadeBefore() throws Exception {
        String email = newEmail();
        String before = register(email, "correct horse").get("token").asText();
        String alsoBefore = body(login(email, "correct horse")).get("token").asText();
        mvc.perform(get("/api/albums").header("Authorization", bearer(before))).andExpect(status().isOk());

        String code = resetCode(email);
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());

        for (String old : List.of(before, alsoBefore)) {
            mvc.perform(get("/api/albums").header("Authorization", bearer(old)))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("unauthorized"));
        }
        String after = body(login(email, NEW_PASSWORD)).get("token").asText();
        mvc.perform(get("/api/albums").header("Authorization", bearer(after))).andExpect(status().isOk());
    }

    @Test
    void aLinkWorksOnlyOnce() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());

        confirm(code, "yet another 3rd one", "yet another 3rd one", newAddress())
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_invalid"));
        check(code, newAddress()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_invalid"));
        login(email, NEW_PASSWORD).andExpect(status().isOk());
    }

    @Test
    void anExpiredLinkIsRefusedAndChangesNothing() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);
        jdbc.update("update keepsake.password_reset_tokens set expires_at = now() - interval '1 second' where token_hash = ?", sha256(code));

        check(code, newAddress()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_expired"));
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress())
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_expired"));
        login(email, "correct horse").andExpect(status().isOk());
    }

    @Test
    void madeUpLinksAreRefused() throws Exception {
        for (String code : List.of("x".repeat(43), "not-even-the-right-length", "../../etc/passwd", "a".repeat(128))) {
            check(code, newAddress()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_invalid"));
            confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress())
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("reset_invalid"));
        }
        check("", newAddress()).andExpect(status().isBadRequest());
    }

    @Test
    void mismatchedOrWeakPasswordsAreRefusedAndTheLinkStillWorks() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);

        confirm(code, NEW_PASSWORD, NEW_PASSWORD + "!", newAddress())
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("password_mismatch"));
        for (String weak : List.of("short1", "aaaaaaaaaa", "Password123", "onlyletters", "1234567890123", "x".repeat(73))) {
            confirm(code, weak, weak, newAddress())
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("weak_password"));
        }
        login(email, "correct horse").andExpect(status().isOk());
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());
    }

    // ---- limits ------------------------------------------------------------------------

    @Test
    void anInboxCantBeFloodedAndOneMachineCantAskEndlessly() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        for (int i = 0; i < 5; i += 1) requestReset(email, newAddress()).andExpect(status().isAccepted());
        awaitCode(email, 2);
        Thread.sleep(300);
        assertEquals(3, emailsTo(email).size(), "at most three emails in half an hour");

        String address = newAddress();
        for (int i = 0; i < 10; i += 1) requestReset(newEmail(), address).andExpect(status().isAccepted());
        requestReset(newEmail(), address).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("too_many"));
    }

    @Test
    void guessingCodesIsCutShort() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);
        String address = newAddress();
        for (int i = 0; i < 20; i += 1) {
            confirm(UUID.randomUUID().toString().replace("-", "") + "abcdefghijk", NEW_PASSWORD, NEW_PASSWORD, address)
                    .andExpect(status().isBadRequest());
        }
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, address).andExpect(status().isTooManyRequests());
        // Somewhere else, the real link still works.
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());
    }

    @Test
    void aResetClearsEarlierWrongPasswordAttempts() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String address = newAddress();
        for (int i = 0; i < 8; i += 1) postJson("/api/auth/login", Map.of("email", email, "password", "wrong"), address);
        postJson("/api/auth/login", Map.of("email", email, "password", "correct horse"), address)
                .andExpect(status().isTooManyRequests());

        String code = resetCode(email);
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, address).andExpect(status().isNoContent());
        postJson("/api/auth/login", Map.of("email", email, "password", NEW_PASSWORD), address).andExpect(status().isOk());
    }

    // ---- compatibility and privacy -------------------------------------------------------

    @Test
    void signInsFromBeforeThisFeatureStillWork() throws Exception {
        String email = newEmail();
        String userId = register(email, "correct horse").at("/user/id").asText();
        Instant now = Instant.now();
        // Exactly as tokens were made before session versions existed: no "sv" claim.
        JwtClaimsSet claims = JwtClaimsSet.builder().subject(userId).issuedAt(now).expiresAt(now.plusSeconds(600)).build();
        String old = jwtEncoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        mvc.perform(get("/api/auth/me").header("Authorization", bearer(old))).andExpect(status().isOk());

        confirm(resetCode(email), NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());
        mvc.perform(get("/api/auth/me").header("Authorization", bearer(old))).andExpect(status().isUnauthorized());
    }

    @Test
    void codesAndPasswordsNeverReachTheLogs(CapturedOutput output) throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        String code = resetCode(email);
        check(code, newAddress());
        confirm(code, NEW_PASSWORD, "different", newAddress());
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress()).andExpect(status().isNoContent());
        confirm(code, NEW_PASSWORD, NEW_PASSWORD, newAddress());
        assertFalse(output.getAll().contains(code), "the code isn't logged");
        assertFalse(output.getAll().contains(NEW_PASSWORD), "the password isn't logged");
    }
}
