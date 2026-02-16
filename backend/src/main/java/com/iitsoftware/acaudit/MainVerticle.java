package com.iitsoftware.acaudit;

import io.vertx.core.AbstractVerticle;
import io.vertx.core.Promise;

public class MainVerticle extends AbstractVerticle {

    @Override
    public void start(Promise<Void> startPromise) {
        // Ensure compatibility with updated frontend
        vertx.createHttpServer()
            .requestHandler(req -> req.response().end("Hello from Vert.x!"))
            .listen(8080, http -> {
                if (http.succeeded()) {
                    startPromise.complete();
                } else {
                    startPromise.fail(http.cause());
                }
            });
    }
}
