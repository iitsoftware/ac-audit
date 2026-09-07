# Task 993: Add accessible names to Companies icon-only controls

- [x] Inspect generated icon-only buttons in `public/companies.js`.
- [x] Add explicit `aria-label` values to Companies/AC-Audit icon-only controls, including checklist/CAP share controls.
- [x] Verify the changed file for missing icon-only accessible names and syntax issues.

## Review

Verification:
- `node --check public/companies.js` passed.
- `git diff --check` passed.
- Static scan confirmed generated `btn-icon`, `pane-action-btn`, `icon-btn`, and `select-share-btn` buttons all carry `aria-label`.
