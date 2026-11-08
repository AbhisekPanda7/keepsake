package com.keepsake.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class AuthDtos {

    private AuthDtos() {}

    public record RegisterRequest(
            @NotBlank @Email @Size(max = 254) String email,
            // BCrypt only uses the first 72 bytes, so longer passwords are refused
            // rather than being silently cut short.
            @NotBlank @Size(min = 8, max = 72) String password,
            @Size(max = 80) String displayName) {}

    public record LoginRequest(@NotBlank @Size(max = 254) String email, @NotBlank @Size(max = 72) String password) {}

    public record UserResponse(String id, String email, String displayName, long createdAt) {
        static UserResponse from(User user) {
            return new UserResponse(user.id.toString(), user.email, user.displayName, user.createdAt.toEpochMilli());
        }
    }

    public record AuthResponse(String token, long expiresAt, UserResponse user) {}

    // ---- forgotten passwords ----

    public record ResetRequest(@NotBlank @Email @Size(max = 254) String email) {}

    /** The code from a reset link. Sent in a request body, never in a URL, which servers log. */
    public record ResetCodeRequest(@NotBlank @Size(max = 128) String token) {}

    /** The password's own rules are checked by the service, which explains what to change. */
    public record ResetPasswordRequest(
            @NotBlank @Size(max = 128) String token,
            @NotNull @Size(max = 256) String password,
            @NotNull @Size(max = 256) String confirmPassword) {}

    public record ResetRequestedResponse(String message) {}

    public record ResetCheckResponse(long expiresAt) {}
}
