# Task 991: Expose AC-Change Filter Button State

- [x] Inspect generated AC-Change filter buttons in `public/change.js`.
- [x] Add `aria-pressed` to status, category and task filter buttons.
- [x] Verify JavaScript syntax and whitespace.

## Review

Verification:
- `node --check public/change.js`
- `git diff --check`
- Static scan: every generated `.audit-filter-btn` template in `public/change.js` has `aria-pressed`.
