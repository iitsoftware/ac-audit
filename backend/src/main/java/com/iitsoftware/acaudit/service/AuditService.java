package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.AuditEntry;
import com.iitsoftware.acaudit.repository.AuditRepository;
import io.vertx.core.Future;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public class AuditService {

    private final AuditRepository repository;

    public AuditService(AuditRepository repository) {
        this.repository = repository;
    }

    public Future<List<AuditEntry>> findAll(int limit, int offset) {
        return repository.findAll(limit, offset);
    }

    public Future<AuditEntry> findById(UUID id) {
        return repository.findById(id);
    }

    public Future<List<AuditEntry>> findByEntityType(String entityType, int limit, int offset) {
        return repository.findByEntityType(entityType, limit, offset);
    }

    public Future<List<AuditEntry>> findByDateRange(OffsetDateTime from, OffsetDateTime to, int limit, int offset) {
        return repository.findByDateRange(from, to, limit, offset);
    }

    public Future<AuditEntry> create(AuditEntry entry) {
        return repository.save(entry);
    }

    public Future<Long> count() {
        return repository.count();
    }
}
