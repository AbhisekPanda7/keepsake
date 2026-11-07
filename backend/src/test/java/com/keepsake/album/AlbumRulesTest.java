package com.keepsake.album;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.keepsake.album.AlbumDtos.ThemeDto;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AlbumRulesTest {

    @Test
    void blankTitlesBecomeTheDefaultAndLongOnesAreCut() {
        assertEquals("Our Memories", AlbumRules.cleanTitle(null));
        assertEquals("Our Memories", AlbumRules.cleanTitle("   "));
        assertEquals("Puri", AlbumRules.cleanTitle("  Puri "));
        assertEquals(48, AlbumRules.cleanTitle("x".repeat(100)).length());
    }

    @Test
    void aCopyOfALongTitleStillFits() {
        String title = AlbumRules.copyTitle("x".repeat(48));
        assertEquals(48, title.length());
        assertTrue(title.endsWith(" (copy)"));
    }

    @Test
    void captionsAreOneTidyLine() {
        assertEquals("At the lake", AlbumRules.cleanCaption("  At   the\n lake "));
        assertEquals("", AlbumRules.cleanCaption(null));
        assertEquals(140, AlbumRules.cleanCaption("x".repeat(500)).length());
    }

    @Test
    void unknownThemePartsBecomeTheDefaults() {
        assertEquals(new ThemeDto("walnut", "leather", "ivory"), AlbumRules.normalizeTheme(null));
        assertEquals(new ThemeDto("walnut", "linen", "ivory"),
                AlbumRules.normalizeTheme(new ThemeDto("neon", "linen", null)));
        assertEquals(new ThemeDto("sand", "linen", "kraft"),
                AlbumRules.normalizeTheme(new ThemeDto("sand", "linen", "kraft")));
    }

    @Test
    void reorderingCanNeverLoseOrDuplicateAPhotograph() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        UUID c = UUID.randomUUID();
        List<UUID> current = List.of(a, b, c);
        assertEquals(List.of(b, a, c), AlbumRules.applyOrder(current, List.of(b, a, c)));
        assertEquals(List.of(c, a, b), AlbumRules.applyOrder(current, List.of(c)));
        assertEquals(List.of(b, a, c), AlbumRules.applyOrder(current, List.of(UUID.randomUUID(), b, b)));
    }

    @Test
    void imageTypeComesFromTheBytes() {
        assertEquals("image/jpeg", AlbumRules.detectImageType(new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0}));
        assertEquals("image/png", AlbumRules.detectImageType(new byte[] {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10}));
        assertEquals("image/webp", AlbumRules.detectImageType("RIFF0000WEBPVP8 ".getBytes()));
        assertNull(AlbumRules.detectImageType("<script>alert(1)</script>".getBytes()));
        assertNull(AlbumRules.detectImageType(new byte[0]));
    }

    @Test
    void fileNamesLoseControlCharacters() {
        assertEquals("ab.jpg", AlbumRules.cleanName("a\u0000b.jpg\n"));
        assertEquals("photograph", AlbumRules.cleanName("  "));
    }
}
