---
section: Fixed
commits:
  - fix(input): anchor the browser IME to the displayed canvas caret
---
**The browser's text input anchor follows the visible caret.** Text fields use the same canvas projection as pointer input, including when the canvas is offset or scaled on the page.
