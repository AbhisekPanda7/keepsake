package com.keepsake.storage;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.keepsake.common.ApiException;
import com.keepsake.config.KeepsakeProperties;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/**
 * Checks the requests against a stand-in server that behaves as Supabase's documentation
 * describes. It isn't real Supabase: that can only be confirmed with a real project.
 */
class SupabasePhotoStorageTest {

    private record Seen(String method, String path, String auth, String apikey, String contentType, byte[] body) {}

    private HttpServer server;
    private final List<Seen> seen = new ArrayList<>();
    private final AtomicInteger status = new AtomicInteger(200);
    private byte[] responseBody = new byte[0];
    private SupabasePhotoStorage storage;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            seen.add(new Seen(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
                    exchange.getRequestHeaders().getFirst("Authorization"),
                    exchange.getRequestHeaders().getFirst("apikey"),
                    exchange.getRequestHeaders().getFirst("Content-Type"), body));
            exchange.sendResponseHeaders(status.get(), responseBody.length == 0 ? -1 : responseBody.length);
            if (responseBody.length > 0) exchange.getResponseBody().write(responseBody);
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/";
        KeepsakeProperties properties = new KeepsakeProperties(null, null, null,
                new KeepsakeProperties.Storage("supabase", null, url, "secret-key", "photos"));
        storage = new SupabasePhotoStorage(properties, RestClient.builder());
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    void uploadsToTheBucketWithTheKeyAndType() {
        storage.put("user/album/photo", new byte[] {1, 2, 3}, "image/jpeg");
        Seen request = seen.get(0);
        assertEquals("POST", request.method());
        assertEquals("/storage/v1/object/photos/user/album/photo", request.path());
        assertEquals(null, request.auth(), "a secret key isn't a JWT, so it isn't sent as one");
        assertEquals("secret-key", request.apikey());
        assertEquals("image/jpeg", request.contentType());
        assertArrayEquals(new byte[] {1, 2, 3}, request.body());
    }

    @Test
    void aLegacyServiceRoleKeyIsAlsoTheBearerToken() {
        String legacy = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";
        KeepsakeProperties properties = new KeepsakeProperties(null, null, null,
                new KeepsakeProperties.Storage("supabase", null, "http://127.0.0.1:" + server.getAddress().getPort(), legacy, "photos"));
        new SupabasePhotoStorage(properties, RestClient.builder()).put("a/b/c", new byte[] {1}, "image/jpeg");
        assertEquals("Bearer " + legacy, seen.get(0).auth());
        assertEquals(legacy, seen.get(0).apikey());
    }

    @Test
    void aNewSecretKeyGoesOnlyInTheApikeyHeader() {
        KeepsakeProperties properties = new KeepsakeProperties(null, null, null,
                new KeepsakeProperties.Storage("supabase", null, "http://127.0.0.1:" + server.getAddress().getPort(), " sb_secret_abc123 ", "photos"));
        new SupabasePhotoStorage(properties, RestClient.builder()).put("a/b/c", new byte[] {1}, "image/jpeg");
        assertEquals(null, seen.get(0).auth());
        assertEquals("sb_secret_abc123", seen.get(0).apikey(), "stray spaces from pasting are trimmed");
    }

    @Test
    void downloadsTheImage() {
        responseBody = new byte[] {9, 8, 7};
        assertArrayEquals(new byte[] {9, 8, 7}, storage.get("user/album/photo"));
        assertEquals("/storage/v1/object/photos/user/album/photo", seen.get(0).path());
    }

    @Test
    void aMissingImageIsNotFound() {
        status.set(404);
        assertEquals("not_found", assertThrows(ApiException.class, () -> storage.get("gone")).code());
    }

    @Test
    void copiesWithinTheBucket() {
        storage.copy("a/b/c", "d/e/f");
        Seen request = seen.get(0);
        assertEquals("/storage/v1/object/copy", request.path());
        String json = new String(request.body(), StandardCharsets.UTF_8);
        assertTrue(json.contains("\"bucketId\":\"photos\"") && json.contains("\"sourceKey\":\"a/b/c\"")
                && json.contains("\"destinationKey\":\"d/e/f\""), json);
    }

    @Test
    void deletingSomethingAlreadyGoneIsFine() {
        status.set(404);
        assertDoesNotThrow(() -> storage.delete("gone"));
        assertEquals("DELETE", seen.get(0).method());
    }

    @Test
    void refusesToStartWithoutItsSettings() {
        KeepsakeProperties missing = new KeepsakeProperties(null, null, null,
                new KeepsakeProperties.Storage("supabase", null, "", "", "photos"));
        assertThrows(IllegalStateException.class, () -> new SupabasePhotoStorage(missing, RestClient.builder()));
    }
}
