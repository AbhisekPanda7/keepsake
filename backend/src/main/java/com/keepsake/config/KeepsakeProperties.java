package com.keepsake.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("keepsake")
public record KeepsakeProperties(Jwt jwt, Cors cors, Quota quota, Storage storage) {

    public record Jwt(String secret, long ttlHours) {}

    public record Cors(List<String> allowedOrigins) {}

    public record Quota(long maxBytesPerUser) {}

    public record Storage(String type, String localDir, String supabaseUrl, String supabaseKey, String supabaseBucket) {}
}
