package com.keepsake;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.keepsake.storage.PhotoStorage;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Runs the whole backend against a real PostgreSQL: requests, security, the database
 * schema and stored files. It's a private throwaway one, so no real database is touched.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiIntegrationTest {

    private static final EmbeddedPostgres POSTGRES;
    private static final Path STORAGE_DIR;

    static {
        try {
            POSTGRES = EmbeddedPostgres.builder().start();
            STORAGE_DIR = Files.createTempDirectory("keepsake-test-photos");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static final int QUOTA_BYTES = 200_000;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> POSTGRES.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "unused");
        registry.add("keepsake.jwt.secret", () -> "a-test-only-secret-that-is-long-enough-to-use");
        registry.add("keepsake.jwt.ttl-hours", () -> "1");
        registry.add("keepsake.cors.allowed-origins", () -> "https://album.example");
        registry.add("keepsake.quota.max-bytes-per-user", () -> QUOTA_BYTES);
        registry.add("keepsake.storage.type", () -> "local");
        registry.add("keepsake.storage.local-dir", STORAGE_DIR::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @MockitoSpyBean PhotoStorage storage;

    @AfterEach
    void forgetInjectedFailures() {
        reset(storage);
    }

    // ---- helpers ----------------------------------------------------------------------

    private String newUser() throws Exception {
        return register(UUID.randomUUID() + "@example.com", "correct horse").get("token").asText();
    }

    private JsonNode register(String email, String password) throws Exception {
        return body(mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", password))))
                .andExpect(status().isCreated()));
    }

    private JsonNode body(ResultActions result) throws Exception {
        String text = result.andReturn().getResponse().getContentAsString();
        return text.isEmpty() ? null : json.readTree(text);
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private String createAlbum(String token, Object fields) throws Exception {
        return body(mvc.perform(post("/api/albums").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(fields)))
                .andExpect(status().isCreated())).get("id").asText();
    }

    private static byte[] jpeg(int size) {
        byte[] bytes = new byte[size];
        bytes[0] = (byte) 0xff;
        bytes[1] = (byte) 0xd8;
        bytes[2] = (byte) 0xff;
        for (int i = 3; i < size; i += 1) bytes[i] = (byte) (i * 31);
        return bytes;
    }

    private ResultActions upload(String token, String albumId, String name, byte[] bytes) throws Exception {
        return mvc.perform(multipart("/api/albums/{id}/photos", albumId)
                .file(new MockMultipartFile("file", name, "image/jpeg", bytes))
                .param("name", name).param("width", "1200").param("height", "800")
                .param("takenAt", "1600000000000").param("takenAtSource", "exif")
                .header("Authorization", bearer(token)));
    }

    private String addPhoto(String token, String albumId, String name) throws Exception {
        return body(upload(token, albumId, name, jpeg(2000)).andExpect(status().isCreated())).get("id").asText();
    }

    private List<String> photoNames(String token, String albumId) throws Exception {
        JsonNode album = body(mvc.perform(get("/api/albums/{id}", albumId).header("Authorization", bearer(token)))
                .andExpect(status().isOk()));
        List<String> names = new ArrayList<>();
        album.get("photos").forEach(p -> names.add(p.get("name").asText()));
        return names;
    }

    private long storedFiles() throws IOException {
        try (Stream<Path> files = Files.walk(STORAGE_DIR)) {
            return files.filter(Files::isRegularFile).count();
        }
    }

    // ---- accounts and security -----------------------------------------------------------

    @Test
    void registerLoginAndIdentify() throws Exception {
        String email = UUID.randomUUID() + "@EXAMPLE.com";
        JsonNode registered = register(email, "correct horse");
        assertEquals(email.toLowerCase(), registered.at("/user/email").asText());

        JsonNode loggedIn = body(mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", "correct horse"))))
                .andExpect(status().isOk()));
        mvc.perform(get("/api/auth/me").header("Authorization", bearer(loggedIn.get("token").asText())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email.toLowerCase()));
    }

    @Test
    void passwordsAreNeverStoredOrReturnedAsTyped() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        JsonNode registered = register(email, "correct horse");
        assertTrue(registered.toString().indexOf("correct horse") < 0, "password not in the response");
        assertTrue(registered.at("/user/passwordHash").isMissingNode());
        String stored = jdbc.queryForObject("select password_hash from keepsake.users where email = ?", String.class, email);
        assertNotEquals("correct horse", stored);
        assertTrue(stored.startsWith("$2"), "stored as a BCrypt hash");
    }

    @Test
    void wrongPasswordAndUnknownEmailGiveTheSameAnswer() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        register(email, "correct horse");
        for (String who : List.of(email, "nobody-" + email)) {
            mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(Map.of("email", who, "password", "wrong password"))))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("bad_credentials"))
                    .andExpect(jsonPath("$.message").value("That email or password isn't right."));
        }
    }

    @Test
    void repeatedWrongPasswordsAreSlowedDown() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        register(email, "correct horse");
        String wrong = json.writeValueAsString(Map.of("email", email, "password", "wrong password"));
        for (int i = 0; i < 8; i += 1) {
            mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(wrong))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", "correct horse"))))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("too_many"));
    }

    @Test
    void badRegistrationsAreRefused() throws Exception {
        String email = UUID.randomUUID() + "@example.com";
        register(email, "correct horse");
        for (Map<String, String> bad : List.of(
                Map.of("email", email.toUpperCase(), "password", "correct horse"),
                Map.of("email", "not-an-email", "password", "correct horse"),
                Map.of("email", "short-" + email, "password", "short"),
                Map.of("email", "long-" + email, "password", "x".repeat(73)))) {
            int code = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                    .content(json.writeValueAsString(bad))).andReturn().getResponse().getStatus();
            assertTrue(code == 400 || code == 409, bad + " gave " + code);
        }
    }

    @Test
    void everythingElseNeedsAValidToken() throws Exception {
        mvc.perform(get("/api/albums")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("unauthorized"));
        mvc.perform(get("/api/albums").header("Authorization", "Bearer not.a.token")).andExpect(status().isUnauthorized());
        String token = newUser();
        // Tampering with a real token's signature must make it worthless.
        String tampered = token.substring(0, token.length() - 3) + (token.endsWith("aaa") ? "bbb" : "aaa");
        mvc.perform(get("/api/albums").header("Authorization", bearer(tampered))).andExpect(status().isUnauthorized());
    }

    @Test
    void theHealthCheckIsPublicAndRevealsNothing() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"))
                .andExpect(jsonPath("$.components").doesNotExist());
        mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
    }

    @Test
    void onlyTheConfiguredWebsiteMayCallFromABrowser() throws Exception {
        mvc.perform(options("/api/albums").header("Origin", "https://album.example")
                .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://album.example"));
        mvc.perform(options("/api/albums").header("Origin", "https://evil.example")
                .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());
    }

    // ---- albums -------------------------------------------------------------------------

    @Test
    void albumsAreCreatedWithSensibleDefaults() throws Exception {
        String token = newUser();
        String id = createAlbum(token, Map.of("title", "   "));
        mvc.perform(get("/api/albums/{id}", id).header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Our Memories"))
                .andExpect(jsonPath("$.description").value(""))
                .andExpect(jsonPath("$.theme.colour").value("walnut"))
                .andExpect(jsonPath("$.theme.material").value("leather"))
                .andExpect(jsonPath("$.theme.paper").value("ivory"))
                .andExpect(jsonPath("$.photos", hasSize(0)));
    }

    @Test
    void albumsListWithCountsAndMostRecentFirst() throws Exception {
        String token = newUser();
        String first = createAlbum(token, Map.of("title", "First"));
        String second = createAlbum(token, Map.of("title", "Second"));
        addPhoto(token, first, "a.jpg");
        addPhoto(token, first, "b.jpg");
        mvc.perform(get("/api/albums").header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].id").value(first))
                .andExpect(jsonPath("$[0].photoCount").value(2))
                .andExpect(jsonPath("$[1].id").value(second))
                .andExpect(jsonPath("$[1].photoCount").value(0));
    }

    @Test
    void renamingAndRethemingLeaveThePhotographsAlone() throws Exception {
        String token = newUser();
        String id = createAlbum(token, Map.of("title", "Old", "description", "Words"));
        addPhoto(token, id, "a.jpg");
        mvc.perform(patch("/api/albums/{id}", id).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"New\",\"theme\":{\"colour\":\"forest\",\"material\":\"linen\",\"paper\":\"neon\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("New"))
                .andExpect(jsonPath("$.description").value("Words"))
                .andExpect(jsonPath("$.theme.colour").value("forest"))
                .andExpect(jsonPath("$.theme.paper").value("ivory"))
                .andExpect(jsonPath("$.photos", hasSize(1)));
    }

    @Test
    void nobodyCanSeeOrChangeSomeoneElsesAlbums() throws Exception {
        String alice = newUser();
        String mallory = newUser();
        String album = createAlbum(alice, Map.of("title", "Private"));
        String photo = addPhoto(alice, album, "a.jpg");
        String auth = bearer(mallory);

        mvc.perform(get("/api/albums").header("Authorization", auth)).andExpect(jsonPath("$", hasSize(0)));
        // The same 404 as for something that doesn't exist, so that nothing is given away.
        mvc.perform(get("/api/albums/{id}", album).header("Authorization", auth)).andExpect(status().isNotFound());
        mvc.perform(patch("/api/albums/{id}", album).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"Mine\"}")).andExpect(status().isNotFound());
        mvc.perform(delete("/api/albums/{id}", album).header("Authorization", auth)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/albums/{id}/photos", album).header("Authorization", auth)).andExpect(status().isNotFound());
        mvc.perform(post("/api/albums/{id}/copies", album).header("Authorization", auth)).andExpect(status().isNotFound());
        mvc.perform(put("/api/albums/{id}/photo-order", album).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[]}")).andExpect(status().isNotFound());
        upload(mallory, album, "b.jpg", jpeg(100)).andExpect(status().isNotFound());
        mvc.perform(get("/api/photos/{id}/content", photo).header("Authorization", auth)).andExpect(status().isNotFound());
        mvc.perform(patch("/api/photos/{id}", photo).header("Authorization", auth)
                .contentType(MediaType.APPLICATION_JSON).content("{\"caption\":\"x\"}")).andExpect(status().isNotFound());
        mvc.perform(delete("/api/photos/{id}", photo).header("Authorization", auth)).andExpect(status().isNotFound());

        assertEquals(List.of("a.jpg"), photoNames(alice, album));
        mvc.perform(get("/api/photos/{id}/content", photo).header("Authorization", bearer(alice))).andExpect(status().isOk());
    }

    @Test
    void anInvalidIdIsSimplyNotFound() throws Exception {
        mvc.perform(get("/api/albums/not-a-uuid").header("Authorization", bearer(newUser())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("not_found"));
    }

    // ---- photographs ----------------------------------------------------------------------

    @Test
    void anUploadedImageComesBackExactlyAndKeepsItsDetails() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        byte[] bytes = jpeg(3000);
        JsonNode photo = body(upload(token, album, "beach.jpg", bytes)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.order").value(0))
                .andExpect(jsonPath("$.name").value("beach.jpg"))
                .andExpect(jsonPath("$.width").value(1200))
                .andExpect(jsonPath("$.takenAt").value(1600000000000L))
                .andExpect(jsonPath("$.takenAtSource").value("exif"))
                .andExpect(jsonPath("$.caption").value("")));
        byte[] back = mvc.perform(get("/api/photos/{id}/content", photo.get("id").asText()).header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/jpeg"))
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andReturn().getResponse().getContentAsByteArray();
        assertArrayEquals(bytes, back);
    }

    @Test
    void anythingThatIsntAnImageIsRefused() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        long before = storedFiles();
        // It claims to be a JPEG, and that's exactly why the bytes are what's checked.
        upload(token, album, "fake.jpg", "<script>alert(1)</script>".getBytes())
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("invalid_image"));
        assertEquals(before, storedFiles());
        assertEquals(List.of(), photoNames(token, album));
    }

    @Test
    void photographsKeepTheirUploadOrderSeparatelyInEachAlbum() throws Exception {
        String token = newUser();
        String a = createAlbum(token, Map.of());
        String b = createAlbum(token, Map.of());
        addPhoto(token, a, "a1.jpg");
        addPhoto(token, b, "b1.jpg");
        addPhoto(token, a, "a2.jpg");
        assertEquals(List.of("a1.jpg", "a2.jpg"), photoNames(token, a));
        assertEquals(List.of("b1.jpg"), photoNames(token, b));
    }

    @Test
    void reorderingIsSavedAndStaysWithinItsAlbum() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        String other = createAlbum(token, Map.of());
        String one = addPhoto(token, album, "1.jpg");
        String two = addPhoto(token, album, "2.jpg");
        String three = addPhoto(token, album, "3.jpg");
        addPhoto(token, other, "x.jpg");

        mvc.perform(put("/api/albums/{id}/photo-order", album).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("ids", List.of(three, one, two)))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(three))
                .andExpect(jsonPath("$[0].order").value(0))
                .andExpect(jsonPath("$[2].order").value(2));
        assertEquals(List.of("3.jpg", "1.jpg", "2.jpg"), photoNames(token, album));
        assertEquals(List.of("x.jpg"), photoNames(token, other));

        // A new photograph goes after the rest, and a partial list loses nothing.
        addPhoto(token, album, "4.jpg");
        mvc.perform(put("/api/albums/{id}/photo-order", album).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("ids", List.of(two, UUID.randomUUID().toString())))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(4)));
        assertEquals(List.of("2.jpg", "3.jpg", "1.jpg", "4.jpg"), photoNames(token, album));
    }

    @Test
    void captionsAreTidiedSavedAndClearable() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        String photo = addPhoto(token, album, "a.jpg");
        mvc.perform(patch("/api/photos/{id}", photo).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{\"caption\":\"  At   the\\n lake \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.caption").value("At the lake"))
                .andExpect(jsonPath("$.name").value("a.jpg"))
                .andExpect(jsonPath("$.takenAt").value(1600000000000L));
        mvc.perform(patch("/api/photos/{id}", photo).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{\"caption\":\"\"}"))
                .andExpect(jsonPath("$.caption").value(""));
        mvc.perform(patch("/api/photos/{id}", photo).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aRemovedPhotographIsHiddenButKept() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        String photo = addPhoto(token, album, "a.jpg");
        String keep = addPhoto(token, album, "b.jpg");
        long before = storedFiles();
        mvc.perform(delete("/api/photos/{id}", photo).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        assertEquals(List.of("b.jpg"), photoNames(token, album));
        mvc.perform(get("/api/photos/{id}/content", photo).header("Authorization", bearer(token))).andExpect(status().isNotFound());
        mvc.perform(patch("/api/photos/{id}", photo).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{\"caption\":\"x\"}")).andExpect(status().isNotFound());
        mvc.perform(delete("/api/photos/{id}", photo).header("Authorization", bearer(token))).andExpect(status().isNotFound());
        mvc.perform(get("/api/albums").header("Authorization", bearer(token))).andExpect(jsonPath("$[0].photoCount").value(1));
        mvc.perform(get("/api/photos/{id}/content", keep).header("Authorization", bearer(token))).andExpect(status().isOk());
        // Still in the database and in storage.
        assertEquals(before, storedFiles());
        assertEquals(1, jdbc.queryForObject("select count(*) from keepsake.photos where id = ?::uuid and deleted_at is not null", Integer.class, photo));
    }

    @Test
    void removedPhotographsDontGetInTheWayOfTheOrder() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        String a = addPhoto(token, album, "a.jpg");
        String b = addPhoto(token, album, "b.jpg");
        String c = addPhoto(token, album, "c.jpg");
        mvc.perform(delete("/api/photos/{id}", a).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        mvc.perform(delete("/api/photos/{id}", b).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        String d = addPhoto(token, album, "d.jpg");
        mvc.perform(put("/api/albums/{id}/photo-order", album).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{\"ids\":[\"" + d + "\",\"" + c + "\"]}"))
                .andExpect(status().isOk());
        assertEquals(List.of("d.jpg", "c.jpg"), photoNames(token, album));
        mvc.perform(delete("/api/albums/{id}/photos", album).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        addPhoto(token, album, "e.jpg");
        assertEquals(List.of("e.jpg"), photoNames(token, album));
    }

    @Test
    void clearingEmptiesOneAlbumOnly() throws Exception {
        String token = newUser();
        String a = createAlbum(token, Map.of("title", "A"));
        String b = createAlbum(token, Map.of("title", "B"));
        addPhoto(token, a, "a.jpg");
        String kept = addPhoto(token, b, "b.jpg");
        long before = storedFiles();
        mvc.perform(delete("/api/albums/{id}/photos", a).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        assertEquals(before, storedFiles(), "the images are kept");
        mvc.perform(get("/api/albums/{id}", a).header("Authorization", bearer(token)))
                .andExpect(jsonPath("$.title").value("A"))
                .andExpect(jsonPath("$.photos", hasSize(0)));
        mvc.perform(get("/api/photos/{id}/content", kept).header("Authorization", bearer(token))).andExpect(status().isOk());
    }

    @Test
    void deletingAnAlbumHidesAllOfItAndKeepsIt() throws Exception {
        String token = newUser();
        String doomed = createAlbum(token, Map.of());
        String kept = createAlbum(token, Map.of());
        addPhoto(token, doomed, "a.jpg");
        addPhoto(token, doomed, "b.jpg");
        String keptPhoto = addPhoto(token, kept, "c.jpg");
        long before = storedFiles();
        mvc.perform(delete("/api/albums/{id}", doomed).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        assertEquals(before, storedFiles(), "the images are kept");
        mvc.perform(get("/api/albums/{id}", doomed).header("Authorization", bearer(token))).andExpect(status().isNotFound());
        mvc.perform(get("/api/albums").header("Authorization", bearer(token))).andExpect(jsonPath("$", hasSize(1)));
        mvc.perform(delete("/api/albums/{id}", doomed).header("Authorization", bearer(token))).andExpect(status().isNotFound());
        mvc.perform(post("/api/albums/{id}/copies", doomed).header("Authorization", bearer(token))).andExpect(status().isNotFound());
        assertEquals(2, jdbc.queryForObject("select count(*) from keepsake.photos where album_id = ?::uuid and deleted_at is not null", Integer.class, doomed));
        assertEquals(1, jdbc.queryForObject("select count(*) from keepsake.albums where id = ?::uuid and deleted_at is not null", Integer.class, doomed));
        mvc.perform(get("/api/photos/{id}/content", keptPhoto).header("Authorization", bearer(token))).andExpect(status().isOk());
    }

    @Test
    void aDuplicateIsCompleteAndIndependent() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of("title", "Blue Coast", "theme", Map.of("colour", "midnight")));
        String one = addPhoto(token, album, "1.jpg");
        addPhoto(token, album, "2.jpg");
        mvc.perform(patch("/api/photos/{id}", one).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{\"caption\":\"Sunset\"}")).andExpect(status().isOk());

        long before = storedFiles();
        JsonNode copy = body(mvc.perform(post("/api/albums/{id}/copies", album).header("Authorization", bearer(token)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Blue Coast (copy)"))
                .andExpect(jsonPath("$.theme.colour").value("midnight"))
                .andExpect(jsonPath("$.photoCount").value(2)));
        assertEquals(before + 2, storedFiles());
        String copyId = copy.get("id").asText();

        JsonNode full = body(mvc.perform(get("/api/albums/{id}", copyId).header("Authorization", bearer(token))));
        assertEquals("Sunset", full.at("/photos/0/caption").asText());
        String copiedPhoto = full.at("/photos/0/id").asText();
        assertNotEquals(one, copiedPhoto);
        mvc.perform(get("/api/photos/{id}/content", copiedPhoto).header("Authorization", bearer(token))).andExpect(status().isOk());

        // Deleting the copy leaves the original as it was.
        mvc.perform(delete("/api/albums/{id}", copyId).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        mvc.perform(get("/api/photos/{id}/content", one).header("Authorization", bearer(token))).andExpect(status().isOk());
    }

    // ---- when things go wrong ----------------------------------------------------------------

    @Test
    void aFailedUploadLeavesNoPhotographBehind() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        doThrow(new IllegalStateException("storage is down")).when(storage).put(anyString(), org.mockito.ArgumentMatchers.any(), anyString());
        upload(token, album, "a.jpg", jpeg(100))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("unknown"))
                // Internal details stay in the log.
                .andExpect(jsonPath("$.message").value("Something went wrong. Please try again."));
        assertEquals(List.of(), photoNames(token, album));
    }

    @Test
    void aFailedDuplicateLeavesNoPartialCopy() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        addPhoto(token, album, "a.jpg");
        addPhoto(token, album, "b.jpg");
        long before = storedFiles();
        // The first copy works, and the second fails.
        org.mockito.Mockito.doCallRealMethod().doThrow(new IllegalStateException("disk full"))
                .when(storage).copy(anyString(), anyString());
        mvc.perform(post("/api/albums/{id}/copies", album).header("Authorization", bearer(token)))
                .andExpect(status().isInternalServerError());
        assertEquals(before, storedFiles(), "the first copy was cleaned up");
        mvc.perform(get("/api/albums").header("Authorization", bearer(token))).andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void deletingNeverTouchesStoredImages() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        String photo = addPhoto(token, album, "a.jpg");
        addPhoto(token, album, "b.jpg");
        doThrow(new IllegalStateException("storage is down")).when(storage).delete(anyString());
        mvc.perform(delete("/api/photos/{id}", photo).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        mvc.perform(delete("/api/albums/{id}/photos", album).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        mvc.perform(delete("/api/albums/{id}", album).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        org.mockito.Mockito.verify(storage, org.mockito.Mockito.never()).delete(anyString());
    }

    @Test
    void anAccountCantGoOverItsStorageLimit() throws Exception {
        String token = newUser();
        String album = createAlbum(token, Map.of());
        upload(token, album, "big.jpg", jpeg(QUOTA_BYTES - 1000)).andExpect(status().isCreated());
        upload(token, album, "over.jpg", jpeg(2000))
                .andExpect(status().isInsufficientStorage())
                .andExpect(jsonPath("$.code").value("quota"));
        assertEquals(List.of("big.jpg"), photoNames(token, album));
        mvc.perform(post("/api/albums/{id}/copies", album).header("Authorization", bearer(token)))
                .andExpect(status().isInsufficientStorage());
        // Another account has its own allowance.
        String other = newUser();
        upload(other, createAlbum(other, Map.of()), "fine.jpg", jpeg(2000)).andExpect(status().isCreated());
    }

    @Test
    void tablesAreOutOfSupabasesPublishedSchema() {
        Integer inPublic = jdbc.queryForObject(
                "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('users', 'albums', 'photos')",
                Integer.class);
        assertEquals(0, inPublic);
    }
}
