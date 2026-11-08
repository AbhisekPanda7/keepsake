package com.keepsake.mail;

/**
 * Sends email. Implementations throw if a message can't be handed over, and must never log
 * a message's contents, which can include a password reset link.
 */
public interface EmailSender {
    void send(EmailMessage message);

    /** False when nothing is actually delivered, so that the app can say so at startup. */
    default boolean delivers() {
        return true;
    }
}
