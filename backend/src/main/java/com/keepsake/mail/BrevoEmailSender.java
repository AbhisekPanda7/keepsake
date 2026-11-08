package com.keepsake.mail;

import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Sends through Brevo's transactional email API, over HTTPS. A web API rather than SMTP,
 * because Render's free plan blocks the usual SMTP ports. Brevo's free plan sends from a
 * single verified address, so no domain of your own is needed.
 */
@Component
@ConditionalOnProperty(name = "keepsake.mail.type", havingValue = "brevo")
public class BrevoEmailSender implements EmailSender {

    private final RestClient client;
    private final Map<String, String> sender;

    public BrevoEmailSender(MailProperties properties, RestClient.Builder builder) {
        if (properties.brevoApiKey().isEmpty() || properties.from().isEmpty()) {
            throw new IllegalStateException("MAIL_TYPE=brevo needs BREVO_API_KEY and MAIL_FROM. See backend/.env.example.");
        }
        this.sender = Map.of("name", properties.fromName(), "email", properties.from());
        this.client = builder
                .baseUrl(properties.brevoUrl().replaceAll("/+$", ""))
                .defaultHeader("api-key", properties.brevoApiKey())
                .defaultHeader("accept", MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    @Override
    public void send(EmailMessage message) {
        client.post()
                .uri("/smtp/email")
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "sender", sender,
                        "to", List.of(Map.of("email", message.to())),
                        "subject", message.subject(),
                        "textContent", message.text(),
                        "htmlContent", message.html()))
                .retrieve()
                .toBodilessEntity();
    }
}
