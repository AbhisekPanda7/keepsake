package com.keepsake;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class KeepsakeApplication {
    public static void main(String[] args) {
        SpringApplication.run(KeepsakeApplication.class, args);
    }
}
