package com.keepsake.storage;

import com.keepsake.common.ApiException;
import com.keepsake.config.KeepsakeProperties;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Keeps images on this computer's disk, for development. Not for Render: its free
 * plan's disk is wiped on every restart, which would lose every photograph.
 */
@Component
@ConditionalOnProperty(name = "keepsake.storage.type", havingValue = "local", matchIfMissing = true)
public class LocalPhotoStorage implements PhotoStorage {

    private final Path root;

    public LocalPhotoStorage(KeepsakeProperties properties) {
        this.root = Path.of(properties.storage().localDir()).toAbsolutePath().normalize();
    }

    @Override
    public void put(String key, byte[] bytes, String contentType) {
        try {
            Path file = resolve(key);
            Files.createDirectories(file.getParent());
            Files.write(file, bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public byte[] get(String key) {
        try {
            return Files.readAllBytes(resolve(key));
        } catch (NoSuchFileException e) {
            throw ApiException.notFound("photograph");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void copy(String fromKey, String toKey) {
        try {
            Path target = resolve(toKey);
            Files.createDirectories(target.getParent());
            Files.copy(resolve(fromKey), target);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public void delete(String key) {
        try {
            Files.deleteIfExists(resolve(key));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Path resolve(String key) {
        Path file = root.resolve(key).normalize();
        if (!file.startsWith(root)) throw new IllegalArgumentException("Storage key outside the storage folder.");
        return file;
    }
}
