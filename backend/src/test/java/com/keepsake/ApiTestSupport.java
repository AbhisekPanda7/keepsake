package com.keepsake;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * The whole backend against a private, throwaway PostgreSQL, shared by the test classes
 * that extend this. Email goes to a temporary outbox folder, where tests read the links.
 */
@SpringBootTest
@AutoConfigureMockMvc
abstract class ApiTestSupport {

    static final EmbeddedPostgres POSTGRES;
    static final Path STORAGE_DIR;
    static final Path OUTBOX_DIR;
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    static {
        try {
            POSTGRES = EmbeddedPostgres.builder().start();
            STORAGE_DIR = Files.createTempDirectory("keepsake-test-photos");
            OUTBOX_DIR = Files.createTempDirectory("keepsake-test-outbox");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> POSTGRES.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "unused");
        registry.add("keepsake.jwt.secret", () -> "a-test-only-secret-that-is-long-enough-to-use");
        registry.add("keepsake.jwt.ttl-hours", () -> "1");
        registry.add("keepsake.cors.allowed-origins", () -> "https://album.example");
        registry.add("keepsake.storage.type", () -> "local");
        registry.add("keepsake.storage.local-dir", STORAGE_DIR::toString);
        registry.add("keepsake.mail.type", () -> "outbox");
        registry.add("keepsake.mail.outbox-dir", OUTBOX_DIR::toString);
        registry.add("keepsake.password-reset.app-url", () -> "https://album.example/");
        registry.add("keepsake.password-reset.token-ttl-minutes", () -> "30");
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    static String newEmail() {
        return UUID.randomUUID() + "@example.com";
    }

    /** A different network address for each use, so that limits in one test don't reach another. */
    static String newAddress() {
        int n = ADDRESSES.incrementAndGet();
        return "10." + (n >> 16 & 255) + "." + (n >> 8 & 255) + "." + (n & 255);
    }

    static RequestPostProcessor from(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }

    static String bearer(String token) {
        return "Bearer " + token;
    }

    JsonNode body(ResultActions result) throws Exception {
        String text = result.andReturn().getResponse().getContentAsString();
        return text.isEmpty() ? null : json.readTree(text);
    }

    ResultActions postJson(String path, Object body, String address) throws Exception {
        return mvc.perform(post(path).with(from(address)).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body)));
    }

    JsonNode register(String email, String password) throws Exception {
        return body(postJson("/api/auth/register", Map.of("email", email, "password", password), newAddress())
                .andExpect(status().isCreated()));
    }

    String newUser() throws Exception {
        return register(newEmail(), "correct horse").get("token").asText();
    }

    ResultActions login(String email, String password) throws Exception {
        return postJson("/api/auth/login", Map.of("email", email, "password", password), newAddress());
    }
}
