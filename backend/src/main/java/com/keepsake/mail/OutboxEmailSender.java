package com.keepsake.mail;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * For development only: each message is written to a file in a folder (backend/data/outbox
 * by default) instead of being sent, so that a reset link can be followed locally. Never
 * use this on a server, where anyone who could read the folder could reset passwords.
 */
@Component
@ConditionalOnProperty(name = "keepsake.mail.type", havingValue = "outbox")
public class OutboxEmailSender implements EmailSender {

    private final Path folder;

    public OutboxEmailSender(MailProperties properties) {
        this.folder = Path.of(properties.outboxDir()).toAbsolutePath();
    }

    @Override
    public void send(EmailMessage message) {
        String file = System.currentTimeMillis() + "-" + UUID.randomUUID() + ".txt";
        String content = "To: " + message.to() + "\nSubject: " + message.subject() + "\n\n" + message.text() + "\n";
        try {
            Files.createDirectories(folder);
            Files.writeString(folder.resolve(file), content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Couldn't write to the mail outbox", e);
        }
    }
}
