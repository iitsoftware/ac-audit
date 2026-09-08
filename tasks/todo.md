# Task 993: Add accessible names to Companies icon-only controls

- [x] Resolve `origin/main` merge conflict in `tasks/todo.md`.
- [x] Inspect generated icon-only buttons in `public/companies.js`.
- [x] Add explicit `aria-label` values to Companies/AC-Audit icon-only controls, including checklist/CAP share controls.
- [x] Re-scan generated DOM-created icon-only controls after merge/rework.
- [x] Add explicit accessible names to evidence thumbnail remove controls.
- [x] Verify the changed file for missing icon-only accessible names and syntax issues.

## Review

Verification:
- `node --check public/companies.js` passed.
- `git diff --check` passed.
- Static scan confirmed generated `btn-icon`, `pane-action-btn`, `icon-btn`, `select-share-btn`, and DOM-created evidence remove buttons carry `aria-label`.
