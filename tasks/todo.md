# Task 987: Expose hidden row and tile actions on keyboard focus

- [x] Inspect existing CSS for hover-only action controls.
- [x] Update row actions to show when the table row contains focus.
- [x] Update audit plan tile actions to show when the tile contains focus.
- [x] Verify the stylesheet selectors.

## Review

Verification:
- `node -e` check confirmed both `:focus-within` selectors are present.
- `git diff --check` passed.
- `package.json` has no lint/build script beyond `start` and `dev`.
