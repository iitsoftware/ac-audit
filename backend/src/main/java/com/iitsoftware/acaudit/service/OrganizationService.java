package com.iitsoftware.acaudit.service;

import com.iitsoftware.acaudit.model.Company;
import com.iitsoftware.acaudit.model.Department;
import com.iitsoftware.acaudit.repository.AuditInstanceRepository;
import com.iitsoftware.acaudit.repository.CompanyRepository;
import com.iitsoftware.acaudit.repository.DepartmentRepository;
import io.vertx.core.Future;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

import java.util.List;
import java.util.UUID;

public class OrganizationService {

    private final CompanyRepository companyRepository;
    private final DepartmentRepository departmentRepository;
    private final AuditInstanceRepository auditInstanceRepository;

    public OrganizationService(CompanyRepository companyRepository, DepartmentRepository departmentRepository,
                               AuditInstanceRepository auditInstanceRepository) {
        this.companyRepository = companyRepository;
        this.departmentRepository = departmentRepository;
        this.auditInstanceRepository = auditInstanceRepository;
    }

    // Company operations

    public Future<List<Company>> findAllCompanies(int limit, int offset) {
        return companyRepository.findAll(limit, offset);
    }

    public Future<List<Company>> findAllActiveCompanies(int limit, int offset) {
        return companyRepository.findAllActive(limit, offset);
    }

    public Future<JsonArray> findAllCompaniesWithAuditCounts(int limit, int offset) {
        return companyRepository.findAll(limit, offset)
            .compose(companies -> {
                if (companies.isEmpty()) {
                    return Future.succeededFuture(new JsonArray());
                }
                List<Future<JsonObject>> futures = companies.stream()
                    .map(company -> auditInstanceRepository.countByCompanyId(company.id())
                        .map(count -> company.toJson().put("auditCount", count)))
                    .toList();
                return Future.all(futures).map(cf -> {
                    JsonArray result = new JsonArray();
                    for (int i = 0; i < futures.size(); i++) {
                        result.add(cf.resultAt(i));
                    }
                    return result;
                });
            });
    }

    public Future<JsonArray> findAllActiveCompaniesWithAuditCounts(int limit, int offset) {
        return companyRepository.findAllActive(limit, offset)
            .compose(companies -> {
                if (companies.isEmpty()) {
                    return Future.succeededFuture(new JsonArray());
                }
                List<Future<JsonObject>> futures = companies.stream()
                    .map(company -> auditInstanceRepository.countByCompanyId(company.id())
                        .map(count -> company.toJson().put("auditCount", count)))
                    .toList();
                return Future.all(futures).map(cf -> {
                    JsonArray result = new JsonArray();
                    for (int i = 0; i < futures.size(); i++) {
                        result.add(cf.resultAt(i));
                    }
                    return result;
                });
            });
    }

    public Future<Company> findCompanyById(UUID id) {
        return companyRepository.findById(id);
    }

    public Future<Company> createCompany(Company company) {
        return companyRepository.save(company);
    }

    public Future<Company> updateCompany(Company company) {
        return companyRepository.save(company);
    }

    public Future<Boolean> deleteCompany(UUID id) {
        return auditInstanceRepository.countByCompanyId(id)
            .compose(count -> {
                if (count > 0) {
                    return Future.failedFuture(new IllegalStateException(
                        "Cannot delete company: " + count + " audit(s) exist for this company's departments"));
                }
                return companyRepository.delete(id);
            });
    }

    // Department operations

    public Future<List<Department>> findDepartmentsByCompanyId(UUID companyId, int limit, int offset) {
        return departmentRepository.findByCompanyId(companyId, limit, offset);
    }

    public Future<List<Department>> findActiveDepartmentsByCompanyId(UUID companyId, int limit, int offset) {
        return departmentRepository.findByCompanyIdActive(companyId, limit, offset);
    }

    public Future<JsonArray> findDepartmentsByCompanyIdWithAuditCounts(UUID companyId, int limit, int offset) {
        return departmentRepository.findByCompanyId(companyId, limit, offset)
            .compose(departments -> {
                if (departments.isEmpty()) {
                    return Future.succeededFuture(new JsonArray());
                }
                List<Future<JsonObject>> futures = departments.stream()
                    .map(dept -> auditInstanceRepository.countByDepartmentId(dept.id())
                        .map(count -> dept.toJson().put("auditCount", count)))
                    .toList();
                return Future.all(futures).map(cf -> {
                    JsonArray result = new JsonArray();
                    for (int i = 0; i < futures.size(); i++) {
                        result.add(cf.resultAt(i));
                    }
                    return result;
                });
            });
    }

    public Future<JsonArray> findActiveDepartmentsByCompanyIdWithAuditCounts(UUID companyId, int limit, int offset) {
        return departmentRepository.findByCompanyIdActive(companyId, limit, offset)
            .compose(departments -> {
                if (departments.isEmpty()) {
                    return Future.succeededFuture(new JsonArray());
                }
                List<Future<JsonObject>> futures = departments.stream()
                    .map(dept -> auditInstanceRepository.countByDepartmentId(dept.id())
                        .map(count -> dept.toJson().put("auditCount", count)))
                    .toList();
                return Future.all(futures).map(cf -> {
                    JsonArray result = new JsonArray();
                    for (int i = 0; i < futures.size(); i++) {
                        result.add(cf.resultAt(i));
                    }
                    return result;
                });
            });
    }

    public Future<Department> findDepartmentById(UUID id) {
        return departmentRepository.findById(id);
    }

    public Future<Department> createDepartment(Department department) {
        return departmentRepository.save(department);
    }

    public Future<Department> updateDepartment(Department department) {
        return departmentRepository.save(department);
    }

    public Future<Boolean> deleteDepartment(UUID id) {
        return auditInstanceRepository.countByDepartmentId(id)
            .compose(count -> {
                if (count > 0) {
                    return Future.failedFuture(new IllegalStateException(
                        "Cannot delete department: " + count + " audit(s) exist for this department"));
                }
                return departmentRepository.delete(id);
            });
    }

    // Combined operations

    /**
     * Get company with all its departments
     */
    public Future<JsonObject> getCompanyWithDepartments(UUID companyId) {
        return Future.all(
            companyRepository.findById(companyId),
            departmentRepository.findByCompanyId(companyId, 1000, 0)
        ).map(cf -> {
            Company company = cf.resultAt(0);
            List<Department> departments = cf.resultAt(1);

            if (company == null) {
                return null;
            }

            JsonArray departmentsJson = new JsonArray();
            departments.forEach(d -> departmentsJson.add(d.toJson()));

            return company.toJson().put("departments", departmentsJson);
        });
    }

    /**
     * Get full organization hierarchy (all companies with their departments)
     */
    public Future<JsonArray> getFullHierarchy() {
        return companyRepository.findAll(1000, 0)
            .compose(companies -> {
                JsonArray result = new JsonArray();
                if (companies.isEmpty()) {
                    return Future.succeededFuture(result);
                }

                List<Future<JsonObject>> futures = companies.stream()
                    .map(company -> getCompanyWithDepartments(company.id()))
                    .toList();

                return Future.all(futures).map(cf -> {
                    for (int i = 0; i < futures.size(); i++) {
                        JsonObject companyWithDepts = cf.resultAt(i);
                        if (companyWithDepts != null) {
                            result.add(companyWithDepts);
                        }
                    }
                    return result;
                });
            });
    }
}
