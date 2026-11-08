package com.keepsake;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The real web server on a real port, called as a browser would call it, which is the
 * only way to test what a simulated request skips, such as the upload size limit.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RealServerTest {

    private static final EmbeddedPostgres POSTGRES;

    static {
        try {
            POSTGRES = EmbeddedPostgres.builder().start();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws IOException {
        String dir = Files.createTempDirectory("keepsake-real-server").toString();
        registry.add("spring.datasource.url", () -> POSTGRES.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "unused");
        registry.add("keepsake.jwt.secret", () -> "a-test-only-secret-that-is-long-enough-to-use");
        registry.add("keepsake.cors.allowed-origins", () -> "https://album.example");
        registry.add("keepsake.storage.type", () -> "local");
        // These tests count albums exactly; StarterAlbumApiTest covers the album new accounts get.
        registry.add("keepsake.starter-album", () -> "false");
        registry.add("keepsake.storage.local-dir", () -> dir);
    }

    @LocalServerPort int port;
    @Autowired ObjectMapper json;

    private final HttpClient http = HttpClient.newHttpClient();

    private HttpRequest.Builder request(String path) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    }

    private String register() throws Exception {
        String body = json.writeValueAsString(java.util.Map.of("email", UUID.randomUUID() + "@example.com", "password", "correct horse"));
        HttpResponse<String> response = http.send(request("/api/auth/register")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(201, response.statusCode());
        return json.readTree(response.body()).get("token").asText();
    }

    private String createAlbum(String token) throws Exception {
        HttpResponse<String> response = http.send(request("/api/albums")
                .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Real\"}")).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(201, response.statusCode());
        return json.readTree(response.body()).get("id").asText();
    }

    private HttpRequest uploadRequest(String token, String album, byte[] file) throws IOException {
        String boundary = "----keepsake" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        for (String[] field : new String[][] {{"name", "real.jpg"}, {"width", "100"}, {"height", "80"}}) {
            body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + field[0] + "\"\r\n\r\n" + field[1] + "\r\n")
                    .getBytes(StandardCharsets.UTF_8));
        }
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"real.jpg\"\r\n"
                + "Content-Type: image/jpeg\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(file);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return request("/api/albums/" + album + "/photos")
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();
    }

    private static byte[] jpeg(int size) {
        byte[] bytes = new byte[size];
        bytes[0] = (byte) 0xff;
        bytes[1] = (byte) 0xd8;
        bytes[2] = (byte) 0xff;
        return bytes;
    }

    @Test
    void aPhotographTravelsThereAndBackOverRealHttp() throws Exception {
        String token = register();
        String album = createAlbum(token);
        byte[] file = jpeg(250_000);
        HttpResponse<String> uploaded = http.send(uploadRequest(token, album, file), HttpResponse.BodyHandlers.ofString());
        assertEquals(201, uploaded.statusCode(), uploaded.body());
        JsonNode photo = json.readTree(uploaded.body());

        HttpResponse<byte[]> back = http.send(request("/api/photos/" + photo.get("id").asText() + "/content")
                .header("Authorization", "Bearer " + token).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, back.statusCode());
        assertEquals("image/jpeg", back.headers().firstValue("Content-Type").orElse(""));
        assertArrayEquals(file, back.body());
    }

    @Test
    void anUploadOverTheLimitIsRefusedClearly() throws Exception {
        String token = register();
        String album = createAlbum(token);
        HttpResponse<String> response = http.send(uploadRequest(token, album, jpeg(10 * 1024 * 1024 + 1)), HttpResponse.BodyHandlers.ofString());
        assertEquals(413, response.statusCode(), response.body());
        assertEquals("too_large", json.readTree(response.body()).get("code").asText());
    }

    @Test
    void aBrowserOnTheRealSiteGetsCorsHeadersOnErrorsToo() throws Exception {
        HttpResponse<String> response = http.send(request("/api/albums")
                .header("Origin", "https://album.example").GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, response.statusCode());
        assertEquals("https://album.example", response.headers().firstValue("Access-Control-Allow-Origin").orElse(""));
        assertEquals("unauthorized", json.readTree(response.body()).get("code").asText());
    }
}
