package com.keepsake.mail;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Used until an email service is configured. Nothing is sent, and the app says so. */
@Component
@ConditionalOnProperty(name = "keepsake.mail.type", havingValue = "none", matchIfMissing = true)
public class NoEmailSender implements EmailSender {

    @Override
    public void send(EmailMessage message) {
        throw new IllegalStateException("No email service is configured (MAIL_TYPE=none).");
    }

    @Override
    public boolean delivers() {
        return false;
    }
}
