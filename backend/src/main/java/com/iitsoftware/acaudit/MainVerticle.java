package com.iitsoftware.acaudit;

import io.vertx.core.AbstractVerticle;

public class MainVerticle extends AbstractVerticle {

    @Override
    public void start() {
        // Ensure compatibility with updated frontend
        // Optimize startup configurations
        vertx.createHttpServer().requestHandler(req -> {
            req.response().end("Hello from Vert.x!");
        }).listen(8080);
    }
}
