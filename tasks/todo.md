# Task 988: Fix low-contrast small status text

- [x] Inspect the plan tile and dashboard deadline status selectors.
- [x] Darken only the light-mode text colors that fail contrast.
- [x] Verify the selected colors meet WCAG AA contrast for normal text.
- [x] Review the diff for unrelated CSS changes.

## Review

Verification:
- Contrast check confirmed every new light-mode status text color is at least 4.79:1 against `#f8fafc` and at least 5.02:1 against `#ffffff`.
- `git diff --check` passed.
