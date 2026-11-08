package com.keepsake.mail;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * How email is sent. "brevo" sends through Brevo's web API, "outbox" writes each message
 * to a folder for local development, and "none" sends nothing. See backend/.env.example.
 */
@ConfigurationProperties("keepsake.mail")
public record MailProperties(String type, String from, String fromName, String brevoApiKey, String brevoUrl, String outboxDir) {

    public MailProperties {
        type = type == null || type.isBlank() ? "none" : type.trim();
        from = from == null ? "" : from.trim();
        fromName = fromName == null || fromName.isBlank() ? "Keepsake" : fromName.trim();
        brevoApiKey = brevoApiKey == null ? "" : brevoApiKey.trim();
        brevoUrl = brevoUrl == null || brevoUrl.isBlank() ? "https://api.brevo.com/v3" : brevoUrl.trim();
        outboxDir = outboxDir == null || outboxDir.isBlank() ? "./data/outbox" : outboxDir.trim();
    }
}
