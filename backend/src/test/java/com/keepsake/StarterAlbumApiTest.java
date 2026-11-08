package com.keepsake;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Every new account opens on a book: an empty "Our Memories" album in Individual. */
class StarterAlbumApiTest extends ApiTestSupport {

    private JsonNode albums(String token, String category) throws Exception {
        var request = get("/api/albums").header("Authorization", bearer(token));
        if (category != null) request.param("category", category);
        return body(mvc.perform(request).andExpect(status().isOk()));
    }

    @Test
    void aNewAccountStartsWithOneEmptyIndividualAlbum() throws Exception {
        String token = newUser();
        JsonNode all = albums(token, null);
        assertEquals(1, all.size());
        JsonNode starter = all.get(0);
        assertEquals("Our Memories", starter.get("title").asText());
        assertEquals("INDIVIDUAL", starter.get("category").asText());
        assertEquals(0, starter.get("photoCount").asInt());
        assertEquals("", starter.get("description").asText());
        assertEquals("walnut", starter.at("/theme/colour").asText());
        assertEquals(0, albums(token, "COUPLE").size());
    }

    @Test
    void itIsAnOrdinaryAlbumThatCanBeDeleted() throws Exception {
        String token = newUser();
        String id = albums(token, null).get(0).get("id").asText();
        mvc.perform(delete("/api/albums/{id}", id).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        assertEquals(0, albums(token, null).size());
        // Signing in again doesn't bring it back: it's only made with the account.
        String email = body(mvc.perform(get("/api/auth/me").header("Authorization", bearer(token)))).get("email").asText();
        String again = body(login(email, "correct horse").andExpect(status().isOk())).get("token").asText();
        assertEquals(0, albums(again, null).size());
    }

    @Test
    void eachAccountGetsItsOwn() throws Exception {
        String one = newUser();
        String two = newUser();
        assertEquals(1, albums(one, null).size());
        assertEquals(1, albums(two, null).size());
        assertEquals(false, albums(one, null).get(0).get("id").equals(albums(two, null).get(0).get("id")));
    }

    @Test
    void aRefusedRegistrationLeavesNoAlbumBehind() throws Exception {
        String email = newEmail();
        register(email, "correct horse");
        long before = jdbc.queryForObject("select count(*) from keepsake.albums", Long.class);
        postJson("/api/auth/register", Map.of("email", email, "password", "correct horse"), newAddress())
                .andExpect(status().isConflict());
        assertEquals(before, jdbc.queryForObject("select count(*) from keepsake.albums", Long.class));
    }
}
