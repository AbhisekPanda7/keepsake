package com.keepsake.common;

import org.springframework.http.HttpStatus;

/** A failure with a message that's safe and useful to show to the user. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    /**
     * Also used for anything belonging to someone else, so that nobody can learn
     * whether a given album or photograph exists by asking for it.
     */
    public static ApiException notFound(String what) {
        return new ApiException(HttpStatus.NOT_FOUND, "not_found", "This " + what + " is no longer stored.");
    }

    public static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "invalid", message);
    }
}
