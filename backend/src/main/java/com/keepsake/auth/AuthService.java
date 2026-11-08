package com.keepsake.auth;

import com.keepsake.auth.AuthDtos.AuthResponse;
import com.keepsake.auth.AuthDtos.LoginRequest;
import com.keepsake.auth.AuthDtos.RegisterRequest;
import com.keepsake.auth.AuthDtos.UserResponse;
import com.keepsake.album.AlbumService;
import com.keepsake.common.ApiException;
import com.keepsake.config.KeepsakeProperties;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final JwtEncoder jwtEncoder;
    private final LoginThrottle throttle;
    private final Duration tokenLifetime;
    /** Compared against when an email is unknown, so that it takes as long as a wrong password. */
    private final String decoyHash;

    private final AlbumService albums;
    private final TransactionTemplate transaction;
    /** Whether a new account starts with an empty "Our Memories" album. */
    private final boolean starterAlbum;

    public AuthService(UserRepository users, PasswordEncoder passwords, JwtEncoder jwtEncoder, LoginThrottle throttle,
            KeepsakeProperties properties, AlbumService albums, TransactionTemplate transaction,
            @Value("${keepsake.starter-album:true}") boolean starterAlbum) {
        this.albums = albums;
        this.transaction = transaction;
        this.starterAlbum = starterAlbum;
        this.users = users;
        this.passwords = passwords;
        this.jwtEncoder = jwtEncoder;
        this.throttle = throttle;
        this.tokenLifetime = Duration.ofHours(properties.jwt().ttlHours());
        this.decoyHash = passwords.encode(UUID.randomUUID().toString());
    }

    public AuthResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.email());
        if (users.existsByEmail(email)) {
            throw new ApiException(HttpStatus.CONFLICT, "email_taken", "That email already has an account.");
        }
        User user = new User();
        user.id = UUID.randomUUID();
        user.email = email;
        user.passwordHash = passwords.encode(request.password());
        String name = request.displayName() == null ? "" : request.displayName().trim();
        user.displayName = name.isEmpty() ? email.substring(0, email.indexOf('@')) : name;
        user.createdAt = Instant.now();
        // The account and its first album are saved together, or not at all.
        transaction.executeWithoutResult(status -> {
            users.save(user);
            if (starterAlbum) albums.createStarter(user.id);
        });
        return issueToken(user);
    }

    public AuthResponse login(LoginRequest request, String address) {
        String email = normalizeEmail(request.email());
        if (throttle.isBlocked(email, address)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too_many", "Too many attempts. Please try again later.");
        }
        User user = users.findByEmail(email).orElse(null);
        boolean valid = passwords.matches(request.password(), user == null ? decoyHash : user.passwordHash);
        if (user == null || !valid) {
            throttle.recordFailure(email, address);
            // The same answer either way, so that it can't be used to discover who has an account.
            throw new ApiException(HttpStatus.UNAUTHORIZED, "bad_credentials", "That email or password isn't right.");
        }
        throttle.recordSuccess(email, address);
        return issueToken(user);
    }

    public UserResponse currentUser(UUID id) {
        return users.findById(id).map(UserResponse::from)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "Please sign in."));
    }

    private AuthResponse issueToken(User user) {
        Instant now = Instant.now();
        Instant expires = now.plus(tokenLifetime);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(user.id.toString())
                .issuedAt(now)
                .expiresAt(expires)
                // Ends this sign-in when the password is next changed. See SessionVersions.
                .claim("sv", user.sessionVersion)
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return new AuthResponse(token, expires.toEpochMilli(), UserResponse.from(user));
    }

    private static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
