package com.keepsake.common;

/** The body of every error response. `code` is for code to act on, `message` for people. */
public record ApiError(String code, String message) {}
