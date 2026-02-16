package com.iitsoftware.acaudit.service;

import java.util.List;
import java.util.stream.Collectors;

public class AuditInstanceService {

    public List<AuditInstance> getAllAuditInstances() {
        // Optimized method for fetching audit instances
        return auditInstanceRepository.findAll().stream()
                .filter(this::isValidInstance)
                .collect(Collectors.toList());
    }

    private boolean isValidInstance(AuditInstance instance) {
        // Add validation logic to filter instances
        return instance != null && instance.isActive();
    }
}
