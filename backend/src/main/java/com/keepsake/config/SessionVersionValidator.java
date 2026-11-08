package com.keepsake.config;

import com.keepsake.auth.SessionVersions;
import java.util.UUID;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Refuses a sign-in token made before its owner's password last changed. Tokens carry the
 * session version they were made with ("sv"); tokens from before this existed carry none,
 * which counts as 0, the version every account starts at.
 */
class SessionVersionValidator implements OAuth2TokenValidator<Jwt> {

    static final String CLAIM = "sv";
    private static final OAuth2Error ENDED = new OAuth2Error("invalid_token", "This sign-in has ended.", null);

    private final SessionVersions sessions;

    SessionVersionValidator(SessionVersions sessions) {
        this.sessions = sessions;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        UUID user;
        try {
            user = UUID.fromString(jwt.getSubject());
        } catch (RuntimeException e) {
            return OAuth2TokenValidatorResult.failure(ENDED);
        }
        Object claim = jwt.getClaims().get(CLAIM);
        int version = claim instanceof Number number ? number.intValue() : 0;
        Integer current = sessions.current(user);
        return current != null && current == version ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(ENDED);
    }
}
