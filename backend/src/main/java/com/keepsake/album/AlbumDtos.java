package com.keepsake.album;

import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;

/** JSON shapes. Field names and epoch-millisecond dates match the frontend's own records. */
public final class AlbumDtos {

    private AlbumDtos() {}

    public record ThemeDto(String colour, String material, String paper) {}

    public record CreateAlbumRequest(String title, String description, ThemeDto theme) {}

    /** Only the fields present are changed. */
    public record UpdateAlbumRequest(String title, String description, ThemeDto theme) {}

    public record PhotoOrderRequest(@NotNull List<UUID> ids) {}

    public record CaptionRequest(@NotNull String caption) {}

    public record PhotoResponse(
            String id,
            String albumId,
            int order,
            String name,
            int width,
            int height,
            Long takenAt,
            String takenAtSource,
            String caption,
            long addedAt) {
        static PhotoResponse from(Photo p) {
            return new PhotoResponse(p.id.toString(), p.albumId.toString(), p.position, p.name, p.width, p.height,
                    p.takenAt, p.takenAtSource, p.caption, p.addedAt.toEpochMilli());
        }
    }

    public record AlbumResponse(
            String id,
            String title,
            String description,
            ThemeDto theme,
            long createdAt,
            long updatedAt,
            Long photoCount,
            List<PhotoResponse> photos) {

        static AlbumResponse summary(Album a, long photoCount) {
            return new AlbumResponse(a.id.toString(), a.title, a.description, theme(a), a.createdAt.toEpochMilli(),
                    a.updatedAt.toEpochMilli(), photoCount, null);
        }

        static AlbumResponse full(Album a, List<PhotoResponse> photos) {
            return new AlbumResponse(a.id.toString(), a.title, a.description, theme(a), a.createdAt.toEpochMilli(),
                    a.updatedAt.toEpochMilli(), (long) photos.size(), photos);
        }

        private static ThemeDto theme(Album a) {
            return new ThemeDto(a.themeColour, a.themeMaterial, a.themePaper);
        }
    }
}
