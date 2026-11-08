package com.keepsake;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Upgrades a database holding data from before this release, as the deployed one does,
 * and checks that the existing accounts, albums and photographs come through unchanged.
 */
class MigrationTest {

    private static EmbeddedPostgres postgres;
    private static JdbcTemplate jdbc;

    @BeforeAll
    static void start() throws Exception {
        postgres = EmbeddedPostgres.builder().start();
        jdbc = new JdbcTemplate(postgres.getPostgresDatabase());
    }

    @AfterAll
    static void stop() throws Exception {
        postgres.close();
    }

    private static Flyway flyway(String target) {
        return Flyway.configure()
                .dataSource(postgres.getPostgresDatabase())
                .schemas("keepsake")
                .defaultSchema("keepsake")
                .target(target)
                .load();
    }

    @Test
    void existingDataComesThroughAndExistingAlbumsBecomeIndividual() {
        flyway("2").migrate();
        UUID user = UUID.randomUUID();
        UUID album = UUID.randomUUID();
        UUID photo = UUID.randomUUID();
        jdbc.update("insert into keepsake.users values (?, 'old@example.com', '$2a$10$hash', 'Old', now())", user);
        jdbc.update("insert into keepsake.albums (id, owner_id, title, description, theme_colour, theme_material, theme_paper,"
                + " created_at, updated_at) values (?, ?, 'Old album', 'Words', 'forest', 'linen', 'kraft',"
                + " '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')", album, user);
        jdbc.update("insert into keepsake.photos (id, album_id, position, name, width, height, caption, storage_key, content_type,"
                + " size_bytes, added_at) values (?, ?, 0, 'a.jpg', 10, 20, 'A caption', 'k', 'image/jpeg', 99, now())", photo, album);
        Map<String, Object> albumBefore = jdbc.queryForMap("select * from keepsake.albums where id = ?", album);
        Map<String, Object> photoBefore = jdbc.queryForMap("select * from keepsake.photos where id = ?", photo);

        flyway("latest").migrate();

        Map<String, Object> albumAfter = jdbc.queryForMap("select * from keepsake.albums where id = ?", album);
        assertEquals("INDIVIDUAL", albumAfter.remove("category"));
        assertEquals(albumBefore, albumAfter, "every other column is as it was");
        assertEquals(photoBefore, jdbc.queryForMap("select * from keepsake.photos where id = ?", photo));
        assertEquals(0, jdbc.queryForObject("select session_version from keepsake.users where id = ?", Integer.class, user),
                "existing sign-ins carry no version, which counts as 0, so they keep working");
        assertEquals("$2a$10$hash", jdbc.queryForObject("select password_hash from keepsake.users where id = ?", String.class, user));
        assertEquals(0, jdbc.queryForObject("select count(*) from keepsake.password_reset_tokens", Integer.class));

        // And an album added afterwards without saying otherwise is Individual too.
        UUID later = UUID.randomUUID();
        jdbc.update("insert into keepsake.albums (id, owner_id, title, description, theme_colour, theme_material, theme_paper,"
                + " created_at, updated_at) values (?, ?, 'Later', '', 'walnut', 'leather', 'ivory', now(), now())", later, user);
        assertEquals("INDIVIDUAL", jdbc.queryForObject("select category from keepsake.albums where id = ?", String.class, later));
    }
}
