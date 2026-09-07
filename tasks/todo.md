# Task 996: Add accessible names to Trash row actions

- [x] Inspect the generated trash table action buttons.
- [x] Add explicit accessible names for restore and permanent delete actions.
- [x] Verify the JavaScript parses and the diff is clean.

## Review

Verification:
- `node --check public/trash.js` passed.
- `git diff --check` passed.
- Confirmed `views/layout.ejs` loads `/app.js` before `/trash.js`, so `escapeAttr()` is available.
