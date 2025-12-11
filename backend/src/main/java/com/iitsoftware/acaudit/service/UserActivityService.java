package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.UserActivity;
import com.iitsoftware.acaudit.repository.UserActivityRepository;
import io.vertx.core.Future;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public class UserActivityService {

    private final UserActivityRepository repository;

    public UserActivityService(UserActivityRepository repository) {
        this.repository = repository;
    }

    public Future<List<UserActivity>> findAll(int limit, int offset) {
        return repository.findAll(limit, offset);
    }

    public Future<UserActivity> findById(UUID id) {
        return repository.findById(id);
    }

    public Future<List<UserActivity>> findByUserId(String userId, int limit, int offset) {
        return repository.findByUserId(userId, limit, offset);
    }

    public Future<List<UserActivity>> findByDateRange(OffsetDateTime from, OffsetDateTime to, int limit, int offset) {
        return repository.findByDateRange(from, to, limit, offset);
    }

    public Future<UserActivity> create(UserActivity activity) {
        return repository.save(activity);
    }

    public Future<Long> count() {
        return repository.count();
    }

    public Future<Long> countByActivityType(UserActivity.ActivityType type) {
        return repository.countByActivityType(type);
    }
}
