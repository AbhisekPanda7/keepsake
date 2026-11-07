package com.keepsake;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;

/**
 * Runs the real backend on this computer with no database to install: a private PostgreSQL
 * starts alongside it, and both keep their data in backend/data, so albums survive a restart.
 * For development only. It lives with the tests so that it never reaches the deployed app.
 *
 *   mvnw spring-boot:test-run
 *
 * Then the API is at http://localhost:8081. Delete backend/data to start again from nothing.
 */
public final class LocalBackend {

    private LocalBackend() {}

    public static void main(String[] args) throws Exception {
        Path data = Path.of("data").toAbsolutePath();
        Path database = data.resolve("postgres");
        Files.createDirectories(database);
        EmbeddedPostgres postgres = EmbeddedPostgres.builder()
                .setDataDirectory(database)
                .setCleanDataDirectory(false)
                .setPort(54329)
                .start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                postgres.close();
            } catch (Exception e) {
                // Stopping anyway.
            }
        }));

        // Not 8080, which other local projects tend to use.
        setDefault("server.port", "8081");
        setDefault("spring.datasource.url", postgres.getJdbcUrl("postgres", "postgres"));
        setDefault("spring.datasource.username", "postgres");
        setDefault("spring.datasource.password", "unused");
        setDefault("keepsake.jwt.secret", "a-local-development-secret-never-used-anywhere-else");
        setDefault("keepsake.cors.allowed-origins", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001");
        setDefault("keepsake.storage.type", "local");
        setDefault("keepsake.storage.local-dir", data.resolve("photos").toString());
        SpringApplication.run(KeepsakeApplication.class, args);
    }

    /** A -D setting on the command line still wins. */
    private static void setDefault(String key, String value) {
        if (System.getProperty(key) == null) System.setProperty(key, value);
    }
}
