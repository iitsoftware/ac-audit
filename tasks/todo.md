# Task 996: Add accessible names to Trash row actions

- [x] Inspect the generated trash table action buttons.
- [x] Add explicit accessible names for restore and permanent delete actions.
- [x] Merge `origin/main` and resolve the `tasks/todo.md` conflict.
- [x] Verify the JavaScript parses and the merge result is clean.

## Review

Verification:
- `node --check public/trash.js` passed.
- `git diff --check` passed.
- Confirmed `views/layout.ejs` loads `/app.js` before `/trash.js`, so `escapeAttr()` is available.
- Merge conflict in `tasks/todo.md` resolved for this task after integrating `origin/main`.
