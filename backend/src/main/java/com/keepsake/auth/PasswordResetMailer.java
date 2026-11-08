package com.keepsake.auth;

import com.keepsake.mail.EmailMessage;
import com.keepsake.mail.EmailSender;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.HtmlUtils;

/**
 * Writes and sends the reset email. Sending happens in the background, so that asking for
 * a link takes the same time whether or not the email has an account. Nothing logged here
 * ever includes the link, the address or the message.
 */
@Component
public class PasswordResetMailer {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetMailer.class);

    private final EmailSender sender;
    private final ExecutorService background = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "password-reset-mail");
        thread.setDaemon(true);
        return thread;
    });

    public PasswordResetMailer(EmailSender sender) {
        this.sender = sender;
        if (!sender.delivers()) {
            log.warn("No email service is configured (MAIL_TYPE=none), so password reset emails won't be sent.");
        }
    }

    void sendResetLink(String to, String name, String link, long minutes) {
        if (!sender.delivers()) {
            log.warn("A password reset was asked for, but no email service is configured, so nothing was sent.");
            return;
        }
        EmailMessage message = compose(to, name, link, minutes);
        background.execute(() -> {
            try {
                sender.send(message);
            } catch (RuntimeException e) {
                log.warn("A password reset email couldn't be sent ({}).", describe(e));
            }
        });
    }

    static EmailMessage compose(String to, String name, String link, long minutes) {
        String greeting = name == null || name.isBlank() ? "Hello," : "Hello " + name + ",";
        String text = greeting + "\n\n"
                + "Someone asked to reset the password for your Keepsake account. If it was you, open this link to choose a new one:\n\n"
                + link + "\n\n"
                + "The link works once, and only for the next " + minutes + " minutes.\n"
                + "If you didn't ask, you can ignore this email. Your password hasn't changed.\n\n"
                + "Keepsake";
        String safeLink = HtmlUtils.htmlEscape(link);
        String html = "<div style=\"font-family:Georgia,serif;font-size:16px;line-height:1.5;color:#4c3825;max-width:480px\">"
                + "<p>" + HtmlUtils.htmlEscape(greeting) + "</p>"
                + "<p>Someone asked to reset the password for your Keepsake account. If it was you, choose a new one here:</p>"
                + "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:10px 18px;background:#4c3825;color:#fbf6ea;"
                + "text-decoration:none\">Choose a new password</a></p>"
                + "<p style=\"font-size:14px\">The link works once, and only for the next " + minutes + " minutes. "
                + "If you didn't ask, you can ignore this email. Your password hasn't changed.</p>"
                + "<p>Keepsake</p></div>";
        return new EmailMessage(to, "Reset your Keepsake password", text, html);
    }

    /** What went wrong, without anything from the request, which holds the link. */
    private static String describe(RuntimeException e) {
        if (e instanceof RestClientResponseException response) return "the email service answered " + response.getStatusCode().value();
        return e.getClass().getSimpleName();
    }

    @PreDestroy
    void stop() throws InterruptedException {
        background.shutdown();
        background.awaitTermination(5, TimeUnit.SECONDS);
    }
}
