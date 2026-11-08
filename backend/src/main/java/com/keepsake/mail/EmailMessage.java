package com.keepsake.mail;

/** One email to one person, as plain text and as HTML. */
public record EmailMessage(String to, String subject, String text, String html) {}
