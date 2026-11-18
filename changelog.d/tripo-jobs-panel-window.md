---
internal: The Tripo jobs list listens for Escape and outside clicks on the window it is drawn in and uses the theme's spacing and shadow; it looks and behaves as before in the main window.
commits:
  - fix(editor): the Tripo jobs list listens on the window it is drawn in and takes the theme's spacing grid and shadow - its Escape and outside-click listeners were the main window's, and its rows and shadow used values the theme has no step or token for
---
