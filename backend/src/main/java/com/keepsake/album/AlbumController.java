package com.keepsake.album;

import com.keepsake.album.AlbumDtos.AlbumResponse;
import com.keepsake.album.AlbumDtos.CaptionRequest;
import com.keepsake.album.AlbumDtos.CreateAlbumRequest;
import com.keepsake.album.AlbumDtos.PhotoOrderRequest;
import com.keepsake.album.AlbumDtos.PhotoResponse;
import com.keepsake.album.AlbumDtos.UpdateAlbumRequest;
import com.keepsake.album.AlbumService.PhotoContent;
import jakarta.validation.Valid;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** The REST API, one endpoint per function of the frontend's albumStore.js. */
@RestController
@RequestMapping("/api")
public class AlbumController {

    private final AlbumService service;

    public AlbumController(AlbumService service) {
        this.service = service;
    }

    private static UUID owner(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    @GetMapping("/albums")
    List<AlbumResponse> list(@AuthenticationPrincipal Jwt jwt) {
        return service.list(owner(jwt));
    }

    @PostMapping("/albums")
    @ResponseStatus(HttpStatus.CREATED)
    AlbumResponse create(@AuthenticationPrincipal Jwt jwt, @RequestBody CreateAlbumRequest request) {
        return service.create(owner(jwt), request);
    }

    @GetMapping("/albums/{id}")
    AlbumResponse get(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return service.get(owner(jwt), id);
    }

    @PatchMapping("/albums/{id}")
    AlbumResponse update(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody UpdateAlbumRequest request) {
        return service.update(owner(jwt), id, request);
    }

    @DeleteMapping("/albums/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        service.delete(owner(jwt), id);
    }

    @PostMapping("/albums/{id}/copies")
    @ResponseStatus(HttpStatus.CREATED)
    AlbumResponse duplicate(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        return service.duplicate(owner(jwt), id);
    }

    @PostMapping(path = "/albums/{id}/photos", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    PhotoResponse addPhoto(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID id,
            @RequestParam("file") MultipartFile file,
            @RequestParam("name") String name,
            @RequestParam("width") int width,
            @RequestParam("height") int height,
            @RequestParam(value = "takenAt", required = false) Long takenAt,
            @RequestParam(value = "takenAtSource", required = false) String takenAtSource) {
        return service.addPhoto(owner(jwt), id, file, name, width, height, takenAt, takenAtSource);
    }

    @DeleteMapping("/albums/{id}/photos")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void clear(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        service.clear(owner(jwt), id);
    }

    @PutMapping("/albums/{id}/photo-order")
    List<PhotoResponse> reorder(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
            @Valid @RequestBody PhotoOrderRequest request) {
        return service.reorder(owner(jwt), id, request.ids());
    }

    /** An id always refers to the same image, so browsers may keep it, but privately. */
    @GetMapping("/photos/{id}/content")
    ResponseEntity<byte[]> content(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        PhotoContent content = service.content(owner(jwt), id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(content.contentType()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePrivate().immutable())
                .body(content.bytes());
    }

    @PatchMapping("/photos/{id}")
    PhotoResponse setCaption(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody CaptionRequest request) {
        return service.setCaption(owner(jwt), id, request.caption());
    }

    @DeleteMapping("/photos/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deletePhoto(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        service.deletePhoto(owner(jwt), id);
    }
}
