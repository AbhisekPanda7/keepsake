package com.keepsake.auth;

import com.keepsake.auth.AuthDtos.AuthResponse;
import com.keepsake.auth.AuthDtos.LoginRequest;
import com.keepsake.auth.AuthDtos.RegisterRequest;
import com.keepsake.auth.AuthDtos.ResetCheckResponse;
import com.keepsake.auth.AuthDtos.ResetCodeRequest;
import com.keepsake.auth.AuthDtos.ResetPasswordRequest;
import com.keepsake.auth.AuthDtos.ResetRequest;
import com.keepsake.auth.AuthDtos.ResetRequestedResponse;
import com.keepsake.auth.AuthDtos.UserResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final PasswordResetService resets;

    public AuthController(AuthService auth, PasswordResetService resets) {
        this.auth = auth;
        this.resets = resets;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    AuthResponse register(@Valid @RequestBody RegisterRequest request) {
        return auth.register(request);
    }

    @PostMapping("/login")
    AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        return auth.login(request, http.getRemoteAddr());
    }

    /** Always the same answer, so that it can't be used to discover who has an account. */
    @PostMapping("/password-reset")
    @ResponseStatus(HttpStatus.ACCEPTED)
    ResetRequestedResponse requestReset(@Valid @RequestBody ResetRequest request, HttpServletRequest http) {
        resets.requestReset(request.email(), http.getRemoteAddr());
        return new ResetRequestedResponse("If that email belongs to a Keepsake account, a link to choose a new password is on its way."
                + " It works once, for the next " + resets.linkMinutes() + " minutes.");
    }

    @PostMapping("/password-reset/check")
    ResetCheckResponse checkReset(@Valid @RequestBody ResetCodeRequest request, HttpServletRequest http) {
        return resets.check(request.token(), http.getRemoteAddr());
    }

    @PostMapping("/password-reset/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void confirmReset(@Valid @RequestBody ResetPasswordRequest request, HttpServletRequest http) {
        resets.resetPassword(request.token(), request.password(), request.confirmPassword(), http.getRemoteAddr());
    }

    @GetMapping("/me")
    UserResponse me(@AuthenticationPrincipal Jwt jwt) {
        return auth.currentUser(UUID.fromString(jwt.getSubject()));
    }
}
