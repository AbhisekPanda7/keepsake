package com.keepsake.auth;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;

/**
 * What a new password must be, when one is set by resetting. The frontend's
 * lib/account/passwordRules.js checks the same things, so its advice matches.
 */
final class PasswordRules {

    static final int MIN_LENGTH = 8;
    /** BCrypt only uses the first 72 bytes, so longer passwords are refused, not cut short. */
    static final int MAX_BYTES = 72;

    private static final Set<String> COMMON = Set.of(
            "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890",
            "qwertyuiop", "qwerty123", "1q2w3e4r", "iloveyou", "11111111", "00000000", "abc12345", "abcd1234",
            "letmein1", "welcome1", "sunshine", "princess", "football", "baseball", "superman", "keepsake", "keepsake1");

    private PasswordRules() {}

    /** Null if the password is acceptable, otherwise what to change, said plainly. */
    static String problem(String password) {
        if (password == null || password.length() < MIN_LENGTH) {
            return "Please choose a password of at least " + MIN_LENGTH + " characters.";
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            return "That password is too long. Please keep it under " + MAX_BYTES + " characters.";
        }
        if (password.isBlank() || password.chars().distinct().count() == 1) {
            return "Please choose a password that isn't one character repeated.";
        }
        if (COMMON.contains(password.toLowerCase(Locale.ROOT))) {
            return "That password is too easy to guess. Please choose another.";
        }
        if (kinds(password) < 2) {
            return "Please mix letters with numbers, spaces or symbols.";
        }
        return null;
    }

    /** How many of letters, digits, and anything else (spaces and symbols) appear. */
    static int kinds(String password) {
        boolean letter = false;
        boolean digit = false;
        boolean other = false;
        for (int i = 0; i < password.length(); i += 1) {
            char c = password.charAt(i);
            if (Character.isLetter(c)) letter = true;
            else if (Character.isDigit(c)) digit = true;
            else other = true;
        }
        return (letter ? 1 : 0) + (digit ? 1 : 0) + (other ? 1 : 0);
    }
}
