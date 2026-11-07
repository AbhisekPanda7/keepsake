package com.keepsake.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Turns every failure into the same shape, without exposing internal details. */
@RestControllerAdvice
public class RestExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(RestExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ApiError> onApi(ApiException e) {
        return respond(e.status(), e.code(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> onValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .orElse("The request wasn't valid.");
        return respond(HttpStatus.BAD_REQUEST, "invalid", message);
    }

    @ExceptionHandler({
        HttpMessageNotReadableException.class,
        MissingServletRequestParameterException.class,
        MissingServletRequestPartException.class
    })
    ResponseEntity<ApiError> onUnreadable(Exception e) {
        return respond(HttpStatus.BAD_REQUEST, "invalid", "The request wasn't valid.");
    }

    /** An id that isn't even a valid UUID can't refer to anything. */
    @ExceptionHandler({MethodArgumentTypeMismatchException.class, NoResourceFoundException.class})
    ResponseEntity<ApiError> onNotFound(Exception e) {
        return respond(HttpStatus.NOT_FOUND, "not_found", "That wasn't found.");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ApiError> onMethod(HttpRequestMethodNotSupportedException e) {
        return respond(HttpStatus.METHOD_NOT_ALLOWED, "invalid", "That isn't supported here.");
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ApiError> onTooLarge(MaxUploadSizeExceededException e) {
        return respond(HttpStatus.PAYLOAD_TOO_LARGE, "too_large", "That file is too large to upload.");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> onConflict(DataIntegrityViolationException e) {
        log.warn("Data conflict: {}", e.getMostSpecificCause().getMessage());
        return respond(HttpStatus.CONFLICT, "conflict", "That conflicted with another change. Please try again.");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> onUnexpected(Exception e) {
        log.error("Unexpected failure", e);
        return respond(HttpStatus.INTERNAL_SERVER_ERROR, "unknown", "Something went wrong. Please try again.");
    }

    private static ResponseEntity<ApiError> respond(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(new ApiError(code, message));
    }
}
