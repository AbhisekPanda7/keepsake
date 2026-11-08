package com.keepsake.album;

import com.keepsake.common.ApiException;
import java.util.Locale;

/** The two collections the library is divided into. Both hold the same kind of album. */
public enum AlbumCategory {
    INDIVIDUAL,
    COUPLE;

    public static final AlbumCategory DEFAULT = INDIVIDUAL;

    /** Null stays null, meaning "not given". Anything else unknown is refused. */
    static AlbumCategory parse(String value) {
        if (value == null) return null;
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw ApiException.invalid("An album's category must be INDIVIDUAL or COUPLE.");
        }
    }
}
