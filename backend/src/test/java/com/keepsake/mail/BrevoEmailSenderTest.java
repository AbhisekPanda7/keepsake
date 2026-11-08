package com.keepsake.mail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Checks the request against a stand-in server shaped like Brevo's documented API. It isn't
 * Brevo itself: that can only be confirmed with a real Brevo account and key.
 */
class BrevoEmailSenderTest {

    private record Seen(String method, String path, String apiKey, String contentType, JsonNode body) {}

    private HttpServer server;
    private final List<Seen> seen = new ArrayList<>();
    private final AtomicInteger status = new AtomicInteger(201);
    private final ObjectMapper json = new ObjectMapper();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            seen.add(new Seen(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
                    exchange.getRequestHeaders().getFirst("api-key"), exchange.getRequestHeaders().getFirst("Content-Type"),
                    json.readTree(exchange.getRequestBody())));
            byte[] reply = "{\"messageId\":\"<1@brevo>\"}".getBytes();
            exchange.sendResponseHeaders(status.get(), reply.length);
            exchange.getResponseBody().write(reply);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private BrevoEmailSender sender(String key, String from) {
        String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v3/";
        return new BrevoEmailSender(new MailProperties("brevo", from, "Keepsake", key, url, null), RestClient.builder());
    }

    @Test
    void sendsTheMessageToBrevosTransactionalEmailApi() {
        sender(" brevo-key ", "albums@example.com").send(new EmailMessage("friend@example.com", "Subject", "Text", "<p>Html</p>"));
        Seen request = seen.get(0);
        assertEquals("POST", request.method());
        assertEquals("/v3/smtp/email", request.path());
        assertEquals("brevo-key", request.apiKey());
        assertEquals("application/json", request.contentType());
        assertEquals("albums@example.com", request.body().at("/sender/email").asText());
        assertEquals("Keepsake", request.body().at("/sender/name").asText());
        assertEquals("friend@example.com", request.body().at("/to/0/email").asText());
        assertEquals("Subject", request.body().get("subject").asText());
        assertEquals("Text", request.body().get("textContent").asText());
        assertEquals("<p>Html</p>", request.body().get("htmlContent").asText());
    }

    @Test
    void aRefusalIsReportedRatherThanIgnored() {
        status.set(401);
        BrevoEmailSender sender = sender("wrong-key", "albums@example.com");
        assertThrows(RestClientResponseException.class, () -> sender.send(new EmailMessage("a@example.com", "s", "t", "h")));
    }

    @Test
    void refusesToStartWithoutAKeyOrSender() {
        assertThrows(IllegalStateException.class, () -> sender("", "albums@example.com"));
        assertThrows(IllegalStateException.class, () -> sender("key", " "));
    }
}
