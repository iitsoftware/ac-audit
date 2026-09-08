# Task 990: Name AC-Change Icon-Only Controls

- [x] Inspect generated AC-Change controls in `public/change.js`.
- [x] Add explicit `aria-label` values to icon-only and symbol-only buttons.
- [x] Verify JavaScript syntax and whitespace.

## Review

Verification:
- `node --check public/change.js`
- `git diff --check`
- Static scan: every generated `btn-icon` / `pane-action-btn` in `public/change.js` has an explicit `aria-label`; remaining `title` matches are non-button visual indicators.
