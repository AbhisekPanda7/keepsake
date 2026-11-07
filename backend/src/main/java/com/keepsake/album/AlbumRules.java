package com.keepsake.album;

import com.keepsake.album.AlbumDtos.ThemeDto;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The album rules, matching the frontend's so that both treat data alike: themes.js,
 * photoInfo.js, reorder.js and the limits in albumStore.js. Plain code, tested alone.
 */
final class AlbumRules {

    static final String DEFAULT_TITLE = "Our Memories";
    static final int MAX_TITLE_LENGTH = 48;
    static final int MAX_DESCRIPTION_LENGTH = 160;
    static final int MAX_CAPTION_LENGTH = 140;
    static final int MAX_NAME_LENGTH = 255;
    private static final int MAX_IMAGE_SIDE = 20_000;

    private static final Set<String> COLOURS = Set.of("walnut", "burgundy", "forest", "midnight", "graphite", "sand");
    private static final Set<String> MATERIALS = Set.of("leather", "linen");
    private static final Set<String> PAPERS = Set.of("ivory", "white", "kraft", "black");
    private static final String COPY_SUFFIX = " (copy)";

    private AlbumRules() {}

    /** A blank title returns to the default, rather than leaving a blank cover. */
    static String cleanTitle(String title) {
        String clean = truncate(title == null ? "" : title.trim(), MAX_TITLE_LENGTH);
        return clean.isEmpty() ? DEFAULT_TITLE : clean;
    }

    static String cleanDescription(String description) {
        return truncate(description == null ? "" : description.trim(), MAX_DESCRIPTION_LENGTH);
    }

    /** Stored as one tidy line, short enough to print on a page. */
    static String cleanCaption(String caption) {
        String oneLine = caption == null ? "" : caption.replaceAll("\\s+", " ").trim();
        return truncate(oneLine, MAX_CAPTION_LENGTH).trim();
    }

    static String copyTitle(String title) {
        return truncate(title, MAX_TITLE_LENGTH - COPY_SUFFIX.length()) + COPY_SUFFIX;
    }

    static String cleanName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\p{Cntrl}]", "").trim();
        return clean.isEmpty() ? "photograph" : truncate(clean, MAX_NAME_LENGTH);
    }

    static int cleanSide(int side) {
        return Math.max(1, Math.min(MAX_IMAGE_SIDE, side));
    }

    /** Anything unknown becomes the default, so bad data can never break a page. */
    static ThemeDto normalizeTheme(ThemeDto theme) {
        String colour = theme == null ? null : theme.colour();
        String material = theme == null ? null : theme.material();
        String paper = theme == null ? null : theme.paper();
        return new ThemeDto(
                COLOURS.contains(String.valueOf(colour)) ? colour : "walnut",
                MATERIALS.contains(String.valueOf(material)) ? material : "leather",
                PAPERS.contains(String.valueOf(paper)) ? paper : "ivory");
    }

    /**
     * Puts ids in the requested order. Unknown ids are ignored, and any photograph left
     * out keeps its place at the end, so a stale list can never lose a photograph.
     */
    static List<UUID> applyOrder(List<UUID> current, List<UUID> requested) {
        Set<UUID> known = new HashSet<>(current);
        Map<UUID, Boolean> ordered = new LinkedHashMap<>();
        for (UUID id : requested) {
            if (known.contains(id)) ordered.putIfAbsent(id, true);
        }
        for (UUID id : current) {
            ordered.putIfAbsent(id, true);
        }
        return new ArrayList<>(ordered.keySet());
    }

    /** Identifies the image type from the file's own first bytes, not from what it claims. */
    static String detectImageType(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff) {
            return "image/jpeg";
        }
        if (bytes.length >= 8 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G') {
            return "image/png";
        }
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
                && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') {
            return "image/webp";
        }
        return null;
    }

    private static String truncate(String text, int length) {
        return text.length() <= length ? text : text.substring(0, length);
    }
}
