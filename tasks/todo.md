# Task 995: Expose Companies Filter Button State

- [x] Inspect generated CAP and Finding filter buttons in `public/companies.js`.
- [x] Add `aria-pressed` that mirrors the existing `.active` state.
- [x] Verify syntax and static markup coverage.

## Review

Verification:
- `node --check public/companies.js` passed.
- `git diff --check` passed.
- Static scan found all generated `data-cap-filter` buttons now carry `aria-pressed`.
