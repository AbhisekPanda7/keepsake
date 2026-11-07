package com.keepsake.config;

import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Stops before anything connects to anything if a required setting is missing, with a
 * message saying which one. Otherwise the first sign would be a confusing database
 * error, after a failed login attempt had already been made against that database.
 * Runs as the app is being assembled, ahead of the database connection and migrations.
 */
@Component
public class RequiredSettingsCheck implements BeanFactoryPostProcessor, EnvironmentAware {

    private static final int MIN_SECRET_LENGTH = 32;

    private Environment environment;

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        check(environment);
    }

    static void check(Environment environment) {
        String secret = environment.getProperty("keepsake.jwt.secret", "");
        String password = environment.getProperty("spring.datasource.password", "");
        if (secret.length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException("JWT_SECRET must be set, and at least " + MIN_SECRET_LENGTH
                    + " characters long. See backend/.env.example.");
        }
        if (password.isEmpty()) {
            throw new IllegalStateException("DATABASE_PASSWORD must be set. See backend/.env.example.");
        }
    }
}
