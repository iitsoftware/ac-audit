# Task 994: Label CAP and Finding Row Selection Checkboxes

- [x] Inspect CAP and Finding row checkbox rendering in `public/companies.js`.
- [x] Add row-specific accessible names to per-row Finding selection checkboxes.
- [x] Add row-specific accessible names to per-row CAP selection checkboxes.
- [x] Verify syntax and changed checkbox markup.

## Review

Verification:
- `node --check public/companies.js` passed.
- `git diff --check` passed.
- Static scan found no `.finding-select-cb` or `.cap-select-cb` checkbox without `aria-label`.
