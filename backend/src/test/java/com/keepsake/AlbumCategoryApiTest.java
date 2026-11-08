package com.keepsake;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;

/** The library's two collections, Individual and Couple, which are one kind of album. */
class AlbumCategoryApiTest extends ApiTestSupport {

    /** These tests count albums exactly; StarterAlbumApiTest covers the album new accounts get. */
    @DynamicPropertySource
    static void withoutStarterAlbum(DynamicPropertyRegistry registry) {
        registry.add("keepsake.starter-album", () -> "false");
    }

    // ---- helpers ----------------------------------------------------------------------

    private JsonNode create(String token, Object fields) throws Exception {
        return body(mvc.perform(post("/api/albums").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(fields)))
                .andExpect(status().isCreated()));
    }

    private ResultActions change(String token, String albumId, Object fields) throws Exception {
        return mvc.perform(patch("/api/albums/{id}", albumId).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(fields)));
    }

    private JsonNode album(String token, String albumId) throws Exception {
        return body(mvc.perform(get("/api/albums/{id}", albumId).header("Authorization", bearer(token))).andExpect(status().isOk()));
    }

    private List<String> titles(String token, String category) throws Exception {
        var request = get("/api/albums").header("Authorization", bearer(token));
        if (category != null) request.param("category", category);
        List<String> titles = new ArrayList<>();
        body(mvc.perform(request).andExpect(status().isOk())).forEach(a -> titles.add(a.get("title").asText()));
        return titles;
    }

    private static byte[] jpeg(int seed) {
        byte[] bytes = new byte[1500];
        bytes[0] = (byte) 0xff;
        bytes[1] = (byte) 0xd8;
        bytes[2] = (byte) 0xff;
        for (int i = 3; i < bytes.length; i += 1) bytes[i] = (byte) (i * seed);
        return bytes;
    }

    private String addPhoto(String token, String albumId, String name, int seed) throws Exception {
        return body(mvc.perform(multipart("/api/albums/{id}/photos", albumId)
                .file(new MockMultipartFile("file", name, "image/jpeg", jpeg(seed)))
                .param("name", name).param("width", "1200").param("height", "800")
                .header("Authorization", bearer(token))).andExpect(status().isCreated())).get("id").asText();
    }

    // ---- tests -------------------------------------------------------------------------

    @Test
    void aNewAlbumIsIndividualUnlessToldOtherwise() throws Exception {
        String token = newUser();
        assertEquals("INDIVIDUAL", create(token, Map.of("title", "Mine")).get("category").asText());
        assertEquals("INDIVIDUAL", create(token, Map.of()).get("category").asText());
        assertEquals("COUPLE", create(token, Map.of("title", "Ours", "category", "COUPLE")).get("category").asText());
        assertEquals("COUPLE", create(token, Map.of("title", "Ours too", "category", " couple ")).get("category").asText());
        assertEquals("INDIVIDUAL", create(token, Map.of("category", "INDIVIDUAL")).get("category").asText());
    }

    @Test
    void anUnknownCategoryIsRefused() throws Exception {
        String token = newUser();
        mvc.perform(post("/api/albums").header("Authorization", bearer(token)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"x\",\"category\":\"FAMILY\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("invalid"));
        String id = create(token, Map.of("title", "x")).get("id").asText();
        change(token, id, Map.of("category", "")).andExpect(status().isBadRequest());
        change(token, id, Map.of("category", "BOTH")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/albums").param("category", "nope").header("Authorization", bearer(token)))
                .andExpect(status().isBadRequest());
        assertEquals("INDIVIDUAL", album(token, id).get("category").asText(), "a refused change changes nothing");
        assertEquals(List.of("x"), titles(token, null), "and no album was made by the refused request");
    }

    @Test
    void eachCollectionListsOnlyItsOwnAlbumsAndOnlyYours() throws Exception {
        String me = newUser();
        String someoneElse = newUser();
        create(me, Map.of("title", "Travels"));
        create(me, Map.of("title", "Us", "category", "COUPLE"));
        create(me, Map.of("title", "Recipes", "category", "INDIVIDUAL"));
        create(someoneElse, Map.of("title", "Their couple album", "category", "COUPLE"));

        assertEquals(List.of("Us"), titles(me, "COUPLE"));
        assertEquals(List.of("Recipes", "Travels"), titles(me, "INDIVIDUAL"), "most recent first, as before");
        assertEquals(List.of("Recipes", "Us", "Travels"), titles(me, null), "without a category, everything");
        assertEquals(List.of("Their couple album"), titles(someoneElse, "couple"));
        assertEquals(List.of(), titles(someoneElse, "INDIVIDUAL"));
    }

    @Test
    void movingAnAlbumChangesItsCollectionAndNothingElse() throws Exception {
        String token = newUser();
        String id = create(token, Map.of("title", "Summer", "description", "By the sea",
                "theme", Map.of("colour", "forest", "material", "linen", "paper", "kraft"))).get("id").asText();
        String first = addPhoto(token, id, "one.jpg", 3);
        String second = addPhoto(token, id, "two.jpg", 5);
        String third = addPhoto(token, id, "three.jpg", 7);
        mvc.perform(patch("/api/photos/{id}", second).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content("{\"caption\":\"The pier\"}")).andExpect(status().isOk());
        mvc.perform(put("/api/albums/{id}/photo-order", id).header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("ids", List.of(third, first, second)))))
                .andExpect(status().isOk());
        JsonNode before = album(token, id);

        JsonNode moved = body(change(token, id, Map.of("category", "COUPLE")).andExpect(status().isOk()));
        assertEquals("COUPLE", moved.get("category").asText());
        JsonNode after = album(token, id);
        assertEquals("COUPLE", after.get("category").asText());
        ((ObjectNode) after).put("category", "INDIVIDUAL");
        assertEquals(before, after, "same id, title, description, cover, photographs, captions, order and dates");
        assertEquals(List.of("Summer"), titles(token, "COUPLE"));
        assertEquals(List.of(), titles(token, "INDIVIDUAL"));

        byte[] image = mvc.perform(get("/api/photos/{id}/content", first).header("Authorization", bearer(token)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        assertArrayEquals(jpeg(3), image, "the images are untouched");

        change(token, id, Map.of("category", "INDIVIDUAL")).andExpect(status().isOk());
        assertEquals(before, album(token, id), "and back again, exactly as it was");
        assertEquals(List.of("Summer"), titles(token, "INDIVIDUAL"));
    }

    @Test
    void renamingAlongsideAMoveStillCountsAsAnEdit() throws Exception {
        String token = newUser();
        JsonNode created = create(token, Map.of("title", "Before"));
        Thread.sleep(5);
        JsonNode changed = body(change(token, created.get("id").asText(), Map.of("title", "After", "category", "COUPLE"))
                .andExpect(status().isOk()));
        assertEquals("After", changed.get("title").asText());
        assertEquals("COUPLE", changed.get("category").asText());
        assertEquals(true, changed.get("updatedAt").asLong() > created.get("updatedAt").asLong());
    }

    @Test
    void nobodyCanMoveSomeoneElsesAlbum() throws Exception {
        String owner = newUser();
        String other = newUser();
        String id = create(owner, Map.of("title", "Private")).get("id").asText();
        change(other, id, Map.of("category", "COUPLE")).andExpect(status().isNotFound());
        mvc.perform(patch("/api/albums/{id}", id).contentType(MediaType.APPLICATION_JSON).content("{\"category\":\"COUPLE\"}"))
                .andExpect(status().isUnauthorized());
        assertEquals("INDIVIDUAL", album(owner, id).get("category").asText());
        assertEquals(List.of(), titles(other, "INDIVIDUAL"));
    }

    @Test
    void aCopyStaysInTheSameCollectionAndDeletedAlbumsLeaveIt() throws Exception {
        String token = newUser();
        String id = create(token, Map.of("title", "Ours", "category", "COUPLE")).get("id").asText();
        JsonNode copy = body(mvc.perform(post("/api/albums/{id}/copies", id).header("Authorization", bearer(token)))
                .andExpect(status().isCreated()));
        assertEquals("COUPLE", copy.get("category").asText());
        assertEquals(List.of("Ours (copy)", "Ours"), titles(token, "COUPLE"));

        mvc.perform(delete("/api/albums/{id}", id).header("Authorization", bearer(token))).andExpect(status().isNoContent());
        assertEquals(List.of("Ours (copy)"), titles(token, "COUPLE"));
        assertEquals("COUPLE", jdbc.queryForObject("select category from keepsake.albums where id = ?::uuid", String.class, id),
                "the deleted album is still kept, with its category");
    }

    @Test
    void theDatabaseItselfRefusesAnUnknownCategory() {
        String bad = "insert into keepsake.albums (id, owner_id, title, description, theme_colour, theme_material, theme_paper,"
                + " created_at, updated_at, category) select gen_random_uuid(), id, 't', '', 'walnut', 'leather', 'ivory', now(), now(),"
                + " 'FAMILY' from keepsake.users limit 1";
        org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> {
            newUser();
            jdbc.update(bad);
        });
    }
}
