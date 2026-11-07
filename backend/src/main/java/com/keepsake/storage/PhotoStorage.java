package com.keepsake.storage;

/** Where image files live. Details about them are in the database. */
public interface PhotoStorage {

    void put(String key, byte[] bytes, String contentType);

    byte[] get(String key);

    void copy(String fromKey, String toKey);

    void delete(String key);
}
