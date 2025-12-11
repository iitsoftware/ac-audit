package com.iitsoftware.acaudit.config;

import io.vertx.core.Future;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonObject;
import io.vertx.pgclient.PgBuilder;
import io.vertx.pgclient.PgConnectOptions;
import io.vertx.sqlclient.Pool;
import io.vertx.sqlclient.PoolOptions;
import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.Callable;

public class DatabaseConfig {

    private static final Logger logger = LoggerFactory.getLogger(DatabaseConfig.class);

    private final Vertx vertx;
    private final JsonObject config;

    public DatabaseConfig(Vertx vertx, JsonObject config) {
        this.vertx = vertx;
        this.config = config;
    }

    public Future<Void> initializeDatabase() {
        Callable<Void> callable = () -> {
            JsonObject db = config.getJsonObject("db", new JsonObject());

            String jdbcUrl = String.format("jdbc:postgresql://%s:%d/%s",
                db.getString("host", "localhost"),
                db.getInteger("port", 5432),
                db.getString("database", "acaudit"));

            Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl,
                    db.getString("user", "trading"),
                    db.getString("password", "trading"))
                .locations("filesystem:../db/migrations", "classpath:db/migrations")
                .baselineOnMigrate(true)
                .baselineVersion("0")
                .load();

            flyway.migrate();
            logger.info("Database migrations completed");
            return null;
        };

        return vertx.executeBlocking(callable, false);
    }

    public Future<Pool> createPool() {
        JsonObject db = config.getJsonObject("db", new JsonObject());
        JsonObject poolConfig = db.getJsonObject("pool", new JsonObject());

        PgConnectOptions connectOptions = new PgConnectOptions()
            .setHost(db.getString("host", "localhost"))
            .setPort(db.getInteger("port", 5432))
            .setDatabase(db.getString("database", "acaudit"))
            .setUser(db.getString("user", "trading"))
            .setPassword(db.getString("password", "trading"));

        PoolOptions poolOptions = new PoolOptions()
            .setMaxSize(poolConfig.getInteger("maxSize", 10));

        Pool pool = PgBuilder.pool()
            .with(poolOptions)
            .connectingTo(connectOptions)
            .using(vertx)
            .build();

        return pool.query("SELECT 1")
            .execute()
            .map(rs -> {
                logger.info("Database connection pool created");
                return pool;
            });
    }
}
