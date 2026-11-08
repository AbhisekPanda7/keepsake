package com.keepsake.auth;

import com.keepsake.auth.AuthDtos.ResetCheckResponse;
import com.keepsake.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Forgotten passwords. Asking for a link always gets the same answer, whether or not the
 * email has an account. A link carries a random code; the database keeps only its SHA-256
 * hash. A code belongs to one person, lasts a short while, and works once. Setting a new
 * password ends every earlier sign-in, through the session version in each sign-in token.
 */
@Service
public class PasswordResetService {

    private static final SecureRandom RANDOM = new SecureRandom();
    /** 32 random bytes, written in URL-safe base64 without padding. */
    private static final Pattern CODE = Pattern.compile("[A-Za-z0-9_-]{43}");

    private final UserRepository users;
    private final PasswordResetTokenRepository tokens;
    private final PasswordEncoder passwords;
    private final PasswordResetThrottle throttle;
    private final LoginThrottle loginThrottle;
    private final PasswordResetMailer mailer;
    private final SessionVersions sessions;
    private final TransactionTemplate transaction;
    private final PasswordResetProperties properties;

    public PasswordResetService(UserRepository users, PasswordResetTokenRepository tokens, PasswordEncoder passwords,
            PasswordResetThrottle throttle, LoginThrottle loginThrottle, PasswordResetMailer mailer,
            SessionVersions sessions, TransactionTemplate transaction, PasswordResetProperties properties) {
        this.users = users;
        this.tokens = tokens;
        this.passwords = passwords;
        this.throttle = throttle;
        this.loginThrottle = loginThrottle;
        this.mailer = mailer;
        this.sessions = sessions;
        this.transaction = transaction;
        this.properties = properties;
    }

    public long linkMinutes() {
        return properties.tokenTtlMinutes();
    }

    /** Sends a link if the email has an account. Says nothing either way. */
    public void requestReset(String rawEmail, String address) {
        if (!throttle.allowRequestFrom(address)) throw tooMany();
        String email = rawEmail.trim().toLowerCase(Locale.ROOT);
        // Over the limit for this email: quietly send nothing more, so its inbox can't be flooded.
        if (!throttle.allowRequestFor(email)) return;
        User user = users.findByEmail(email).orElse(null);
        if (user == null) return;

        String code = newCode();
        Instant now = Instant.now();
        transaction.executeWithoutResult(status -> {
            tokens.deleteFinished(user.id, now);
            // Only the newest link works.
            tokens.retireAll(user.id, now);
            PasswordResetToken token = new PasswordResetToken();
            token.id = UUID.randomUUID();
            token.userId = user.id;
            token.tokenHash = hash(code);
            token.createdAt = now;
            token.expiresAt = now.plus(Duration.ofMinutes(properties.tokenTtlMinutes()));
            tokens.save(token);
        });
        // In the part of the address after #, which browsers never send to any server.
        String link = properties.appUrl() + "/reset-password#token=" + code;
        mailer.sendResetLink(user.email, user.displayName, link, properties.tokenTtlMinutes());
    }

    /** Whether a link can still be used, so that the page can say so before anything is typed. */
    public ResetCheckResponse check(String code, String address) {
        if (throttle.tooManyBadCodes(address)) throw tooMany();
        PasswordResetToken token = CODE.matcher(code).matches() ? tokens.findByTokenHash(hash(code)).orElse(null) : null;
        requireUsable(token, address);
        return new ResetCheckResponse(token.expiresAt.toEpochMilli());
    }

    public void resetPassword(String code, String password, String confirmPassword, String address) {
        if (throttle.tooManyBadCodes(address)) throw tooMany();
        if (!password.equals(confirmPassword)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "password_mismatch", "The two passwords don't match.");
        }
        String problem = PasswordRules.problem(password);
        if (problem != null) throw new ApiException(HttpStatus.BAD_REQUEST, "weak_password", problem);
        if (!CODE.matcher(code).matches()) requireUsable(null, address);

        // Hashed before the link is held, since BCrypt is slow on purpose.
        String newHash = passwords.encode(password);
        User changed = transaction.execute(status -> {
            PasswordResetToken token = tokens.lockByTokenHash(hash(code)).orElse(null);
            requireUsable(token, address);
            User user = users.findById(token.userId).orElseThrow(PasswordResetService::invalidLink);
            user.passwordHash = newHash;
            user.sessionVersion += 1;
            users.save(user);
            // This link, and any other this person still had, never work again.
            tokens.retireAll(user.id, Instant.now());
            return user;
        });
        sessions.forget(changed.id);
        // Wrong guesses at the old password no longer stand in the way of the new one.
        loginThrottle.recordSuccess(changed.email, address);
    }

    private void requireUsable(PasswordResetToken token, String address) {
        if (token == null || token.usedAt != null) {
            if (token == null) throttle.recordBadCode(address);
            throw invalidLink();
        }
        if (!token.expiresAt.isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "reset_expired",
                    "This reset link has expired. Please ask for a new one.");
        }
    }

    private static ApiException invalidLink() {
        return new ApiException(HttpStatus.BAD_REQUEST, "reset_invalid",
                "This reset link can't be used. It may have been used already, or replaced by a newer one. Please ask for a new link.");
    }

    private static ApiException tooMany() {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too_many", "Too many attempts. Please try again later.");
    }

    private static String newCode() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * A plain SHA-256 is enough here, unlike for passwords: the code is 256 random bits, so
     * there's nothing to guess, however fast each guess is.
     */
    static String hash(String code) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
