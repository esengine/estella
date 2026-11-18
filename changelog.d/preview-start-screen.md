---
section: Fixed
commits:
  - fix(export): a development preview opens without the project's logo or minimum start-screen time, and a web game asks to be turned only on a touch screen - the browser preview held the game back behind its start screen and, for a portrait game in a desktop window, hid it behind a rotate-your-device notice
---
**The browser preview starts as soon as the game is loaded, and a desktop browser never hides a game behind "rotate your device".** A development preview (the editor's **Browser** and **Scan Preview**) no longer shows the project's start-screen logo or holds the game back for its minimum start-screen time; the shipped build still does both. A web game in the wrong orientation now hides itself behind the rotate notice only on a touch screen: a computer's window cannot be turned, so a portrait game in a landscape desktop window is shown letterboxed instead, and the browser's developer tools are never covered.
