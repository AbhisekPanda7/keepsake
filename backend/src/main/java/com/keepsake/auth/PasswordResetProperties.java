package com.keepsake.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Where reset links point (the website), and how long they last. */
@ConfigurationProperties("keepsake.password-reset")
public record PasswordResetProperties(String appUrl, long tokenTtlMinutes) {

    public PasswordResetProperties {
        appUrl = (appUrl == null || appUrl.isBlank() ? "http://localhost:3000" : appUrl.trim()).replaceAll("/+$", "");
        // Long enough to find the email, short enough that a forgotten link soon stops working.
        tokenTtlMinutes = tokenTtlMinutes <= 0 ? 30 : Math.max(5, Math.min(120, tokenTtlMinutes));
    }
}
