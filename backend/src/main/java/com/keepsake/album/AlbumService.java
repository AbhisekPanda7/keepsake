package com.keepsake.album;

import com.keepsake.album.AlbumDtos.AlbumResponse;
import com.keepsake.album.AlbumDtos.CreateAlbumRequest;
import com.keepsake.album.AlbumDtos.PhotoResponse;
import com.keepsake.album.AlbumDtos.ThemeDto;
import com.keepsake.album.AlbumDtos.UpdateAlbumRequest;
import com.keepsake.common.ApiException;
import com.keepsake.config.KeepsakeProperties;
import com.keepsake.storage.PhotoStorage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * Albums and their photographs. Every lookup includes the owner, so someone else's album
 * simply doesn't exist as far as this code is concerned.
 *
 * Images live in object storage and details in the database, and no transaction spans
 * both. So images are stored before the database row is written and removed if that
 * fails. At worst, a failed clean-up leaves an unused file behind. A photograph can never
 * point to an image that's gone.
 *
 * Deleting in the app never erases anything: the album or photograph is marked with
 * deleted_at, which hides it from every request, and its row and image stay where they are.
 */
@Service
public class AlbumService {

    private static final Logger log = LoggerFactory.getLogger(AlbumService.class);

    private final AlbumRepository albums;
    private final PhotoRepository photos;
    private final PhotoStorage storage;
    private final TransactionTemplate transaction;
    private final long maxBytesPerUser;

    public AlbumService(AlbumRepository albums, PhotoRepository photos, PhotoStorage storage,
            TransactionTemplate transaction, KeepsakeProperties properties) {
        this.albums = albums;
        this.photos = photos;
        this.storage = storage;
        this.transaction = transaction;
        this.maxBytesPerUser = properties.quota().maxBytesPerUser();
    }

    // ---- albums ---------------------------------------------------------------------

    public List<AlbumResponse> list(UUID owner) {
        List<Album> owned = albums.findByOwnerIdAndDeletedAtIsNullOrderByUpdatedAtDesc(owner);
        if (owned.isEmpty()) return List.of();
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : photos.countByAlbum(owned.stream().map(a -> a.id).toList())) {
            counts.put((UUID) row[0], (Long) row[1]);
        }
        return owned.stream().map(a -> AlbumResponse.summary(a, counts.getOrDefault(a.id, 0L))).toList();
    }

    public AlbumResponse get(UUID owner, UUID albumId) {
        Album album = owned(owner, albumId);
        return AlbumResponse.full(album, photos.findByAlbumIdAndDeletedAtIsNullOrderByPosition(albumId).stream().map(PhotoResponse::from).toList());
    }

    public AlbumResponse create(UUID owner, CreateAlbumRequest request) {
        Instant now = Instant.now();
        Album album = new Album();
        album.id = UUID.randomUUID();
        album.ownerId = owner;
        album.title = AlbumRules.cleanTitle(request.title());
        album.description = AlbumRules.cleanDescription(request.description());
        applyTheme(album, request.theme());
        album.createdAt = now;
        album.updatedAt = now;
        albums.save(album);
        return AlbumResponse.summary(album, 0);
    }

    public AlbumResponse update(UUID owner, UUID albumId, UpdateAlbumRequest request) {
        return transaction.execute(status -> {
            Album album = owned(owner, albumId);
            if (request.title() != null) album.title = AlbumRules.cleanTitle(request.title());
            if (request.description() != null) album.description = AlbumRules.cleanDescription(request.description());
            if (request.theme() != null) applyTheme(album, request.theme());
            album.updatedAt = Instant.now();
            albums.save(album);
            return AlbumResponse.full(album, photos.findByAlbumIdAndDeletedAtIsNullOrderByPosition(albumId).stream().map(PhotoResponse::from).toList());
        });
    }

    /** Hides the album and its photographs from the app. Their rows and images are kept. */
    public void delete(UUID owner, UUID albumId) {
        transaction.executeWithoutResult(status -> {
            Album album = albums.lockByIdAndOwnerId(albumId, owner).orElseThrow(() -> ApiException.notFound("album"));
            Instant now = Instant.now();
            hidePhotos(albumId, photos.findByAlbumIdAndDeletedAtIsNullOrderByPosition(albumId), now);
            album.deletedAt = now;
            albums.save(album);
        });
    }

    /** Empties an album. The album itself and all other albums stay as they are. */
    public void clear(UUID owner, UUID albumId) {
        transaction.executeWithoutResult(status -> {
            Album album = albums.lockByIdAndOwnerId(albumId, owner).orElseThrow(() -> ApiException.notFound("album"));
            Instant now = Instant.now();
            hidePhotos(albumId, photos.findByAlbumIdAndDeletedAtIsNullOrderByPosition(albumId), now);
            album.updatedAt = now;
            albums.save(album);
        });
    }

    /** Copies an album with its order and captions. A failure leaves no partial copy. */
    public AlbumResponse duplicate(UUID owner, UUID albumId) {
        Album source = owned(owner, albumId);
        List<Photo> originals = photos.findByAlbumIdAndDeletedAtIsNullOrderByPosition(albumId);
        long bytes = originals.stream().mapToLong(p -> p.sizeBytes).sum();
        requireRoomFor(owner, bytes);

        Instant now = Instant.now();
        Album copy = new Album();
        copy.id = UUID.randomUUID();
        copy.ownerId = owner;
        copy.title = AlbumRules.copyTitle(source.title);
        copy.description = source.description;
        copy.themeColour = source.themeColour;
        copy.themeMaterial = source.themeMaterial;
        copy.themePaper = source.themePaper;
        copy.createdAt = now;
        copy.updatedAt = now;

        List<Photo> copies = new ArrayList<>();
        List<String> copied = new ArrayList<>();
        try {
            for (Photo original : originals) {
                Photo photo = new Photo();
                photo.id = UUID.randomUUID();
                photo.albumId = copy.id;
                photo.position = original.position;
                photo.name = original.name;
                photo.width = original.width;
                photo.height = original.height;
                photo.takenAt = original.takenAt;
                photo.takenAtSource = original.takenAtSource;
                photo.caption = original.caption;
                photo.contentType = original.contentType;
                photo.sizeBytes = original.sizeBytes;
                photo.addedAt = original.addedAt;
                photo.storageKey = storageKey(owner, copy.id, photo.id);
                storage.copy(original.storageKey, photo.storageKey);
                copied.add(photo.storageKey);
                copies.add(photo);
            }
            transaction.executeWithoutResult(status -> {
                albums.save(copy);
                photos.saveAll(copies);
            });
        } catch (RuntimeException e) {
            removeImages(copied);
            throw e;
        }
        return AlbumResponse.summary(copy, copies.size());
    }

    // ---- photographs ------------------------------------------------------------------

    public PhotoResponse addPhoto(UUID owner, UUID albumId, MultipartFile file, String name, int width, int height,
            Long takenAt, String takenAtSource) {
        owned(owner, albumId);
        byte[] bytes = readUpload(file);
        String type = AlbumRules.detectImageType(bytes);
        if (type == null) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "invalid_image",
                    "Only image files such as JPG, PNG and WebP can be added.");
        }
        requireRoomFor(owner, bytes.length);

        UUID photoId = UUID.randomUUID();
        String key = storageKey(owner, albumId, photoId);
        storage.put(key, bytes, type);
        try {
            return transaction.execute(status -> {
                Album album = albums.lockByIdAndOwnerId(albumId, owner).orElseThrow(() -> ApiException.notFound("album"));
                Photo photo = new Photo();
                photo.id = photoId;
                photo.albumId = albumId;
                photo.position = photos.lastPosition(albumId) + 1;
                photo.name = AlbumRules.cleanName(name);
                photo.width = AlbumRules.cleanSide(width);
                photo.height = AlbumRules.cleanSide(height);
                photo.takenAt = takenAt != null && takenAt > 0 ? takenAt : null;
                photo.takenAtSource = "exif".equals(takenAtSource) || "file".equals(takenAtSource) ? takenAtSource : null;
                photo.caption = "";
                photo.storageKey = key;
                photo.contentType = type;
                photo.sizeBytes = bytes.length;
                photo.addedAt = Instant.now();
                photos.save(photo);
                album.updatedAt = photo.addedAt;
                albums.save(album);
                return PhotoResponse.from(photo);
            });
        } catch (RuntimeException e) {
            removeImages(List.of(key));
            throw e;
        }
    }

    public record PhotoContent(byte[] bytes, String contentType) {}

    public PhotoContent content(UUID owner, UUID photoId) {
        Photo photo = ownedPhoto(owner, photoId);
        return new PhotoContent(storage.get(photo.storageKey), photo.contentType);
    }

    public PhotoResponse setCaption(UUID owner, UUID photoId, String caption) {
        return transaction.execute(status -> {
            Photo photo = ownedPhoto(owner, photoId);
            photo.caption = AlbumRules.cleanCaption(caption);
            photos.save(photo);
            touch(photo.albumId);
            return PhotoResponse.from(photo);
        });
    }

    /** Hides the photograph from the app. Its row and image are kept. */
    public void deletePhoto(UUID owner, UUID photoId) {
        transaction.executeWithoutResult(status -> {
            UUID albumId = ownedPhoto(owner, photoId).albumId;
            Album album = albums.lockByIdAndOwnerId(albumId, owner).orElseThrow(() -> ApiException.notFound("photograph"));
            // Read again under the lock, in case another request removed it meanwhile.
            Photo photo = ownedPhoto(owner, photoId);
            Instant now = Instant.now();
            hidePhotos(albumId, List.of(photo), now);
            album.updatedAt = now;
            albums.save(album);
        });
    }

    /**
     * Marks photographs deleted and moves them below every position in use, so they never
     * stand in the way of the album's own order. The caller holds the album's lock.
     */
    private void hidePhotos(UUID albumId, List<Photo> hidden, Instant when) {
        int position = Math.min(photos.firstPosition(albumId), 0);
        for (Photo photo : hidden) {
            position -= 1;
            photo.position = position;
            photo.deletedAt = when;
        }
        photos.saveAll(hidden);
    }

    /** Saves a new order in one transaction, so it can't be left half-reordered. */
    public List<PhotoResponse> reorder(UUID owner, UUID albumId, List<UUID> ids) {
        return transaction.execute(status -> {
            Album album = albums.lockByIdAndOwnerId(albumId, owner).orElseThrow(() -> ApiException.notFound("album"));
            Map<UUID, Photo> byId = new HashMap<>();
            List<UUID> current = new ArrayList<>();
            for (Photo photo : photos.findByAlbumIdAndDeletedAtIsNullOrderByPosition(albumId)) {
                byId.put(photo.id, photo);
                current.add(photo.id);
            }
            List<UUID> ordered = AlbumRules.applyOrder(current, ids);
            List<PhotoResponse> result = new ArrayList<>();
            for (int i = 0; i < ordered.size(); i += 1) {
                Photo photo = byId.get(ordered.get(i));
                photo.position = i;
                result.add(PhotoResponse.from(photo));
            }
            photos.saveAll(byId.values());
            album.updatedAt = Instant.now();
            albums.save(album);
            return result;
        });
    }

    // ---- helpers ------------------------------------------------------------------------

    private Album owned(UUID owner, UUID albumId) {
        return albums.findByIdAndOwnerIdAndDeletedAtIsNull(albumId, owner).orElseThrow(() -> ApiException.notFound("album"));
    }

    private Photo ownedPhoto(UUID owner, UUID photoId) {
        return photos.findOwned(photoId, owner).orElseThrow(() -> ApiException.notFound("photograph"));
    }

    private void touch(UUID albumId) {
        albums.findById(albumId).ifPresent(album -> {
            album.updatedAt = Instant.now();
            albums.save(album);
        });
    }

    private static void applyTheme(Album album, ThemeDto requested) {
        ThemeDto theme = AlbumRules.normalizeTheme(requested);
        album.themeColour = theme.colour();
        album.themeMaterial = theme.material();
        album.themePaper = theme.paper();
    }

    private void requireRoomFor(UUID owner, long bytes) {
        if (photos.totalBytes(owner) + bytes > maxBytesPerUser) {
            throw new ApiException(HttpStatus.INSUFFICIENT_STORAGE, "quota",
                    "This account has run out of storage for photographs.");
        }
    }

    private static byte[] readUpload(MultipartFile file) {
        if (file.isEmpty()) throw ApiException.invalid("That file is empty.");
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw ApiException.invalid("That file couldn't be read.");
        }
    }

    /** Generated here and never from user input, so a name can't reach outside its folder. */
    private static String storageKey(UUID owner, UUID albumId, UUID photoId) {
        return owner + "/" + albumId + "/" + photoId;
    }

    /** Best effort: the photographs are already gone, so a failure here only wastes space. */
    private void removeImages(List<String> keys) {
        for (String key : keys) {
            try {
                storage.delete(key);
            } catch (RuntimeException e) {
                log.warn("Couldn't remove stored image {}: {}", key, e.getMessage());
            }
        }
    }
}
