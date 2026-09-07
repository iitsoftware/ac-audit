# Task 989: Associate AC-Change Inline Labels With Fields

- [x] Inspect generated AC-Change detail grids in `public/change.js`.
- [x] Add `for` attributes to change request inline field labels.
- [x] Add `for` attributes to risk analysis inline field labels.
- [x] Add `for` attributes to risk item inline field labels.
- [x] Verify JavaScript syntax and diff cleanliness.

## Review

Verification:
- `node --check public/change.js`
- `git diff --check`
- Static label scan: 21 generated `<label>` elements all have `for` and match the following control id.
