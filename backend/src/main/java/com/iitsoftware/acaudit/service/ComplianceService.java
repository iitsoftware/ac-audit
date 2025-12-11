package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.ComplianceRule;
import com.iitsoftware.acaudit.model.ComplianceStatus;
import com.iitsoftware.acaudit.repository.ComplianceRepository;
import io.vertx.core.Future;

import java.util.List;
import java.util.UUID;

public class ComplianceService {

    private final ComplianceRepository repository;

    public ComplianceService(ComplianceRepository repository) {
        this.repository = repository;
    }

    // Rule operations
    public Future<List<ComplianceRule>> findAllRules(int limit, int offset) {
        return repository.findAllRules(limit, offset);
    }

    public Future<ComplianceRule> findRuleById(UUID id) {
        return repository.findRuleById(id);
    }

    public Future<ComplianceRule> createRule(ComplianceRule rule) {
        return repository.saveRule(rule);
    }

    public Future<ComplianceRule> updateRule(ComplianceRule rule) {
        return repository.saveRule(rule);
    }

    public Future<Boolean> deleteRule(UUID id) {
        return repository.deleteRule(id);
    }

    // Status operations
    public Future<List<ComplianceStatus>> findAllStatus(int limit, int offset) {
        return repository.findAllStatus(limit, offset);
    }

    public Future<List<ComplianceStatus>> findStatusByEntity(String entityType, String entityId) {
        return repository.findStatusByEntity(entityType, entityId);
    }

    public Future<ComplianceStatus> updateStatus(ComplianceStatus status) {
        return repository.saveStatus(status);
    }

    public Future<Long> countByStatus(ComplianceStatus.Status status) {
        return repository.countByStatus(status);
    }
}
