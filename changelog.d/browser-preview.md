---
section: Added
commits:
  - feat(editor): Browser beside Scan Preview opens the current scene in the default browser to debug with its developer tools - the preview build (unminified, with source maps, reloading on save) is also served on 127.0.0.1, so it needs no network, and a preview with no LAN serves this computer alone instead of refusing to start
---
**The editor previews a scene in your own browser with one click, to debug it there.** **Browser**, beside **Scan Preview** in the toolbar, saves the current scene, builds it for the web (unminified, with source maps) and opens it in the default browser, whose developer tools then step through and break in your scripts' own sources. It is the phone preview's session, so a save reloads it the same way, and it is served on `127.0.0.1` beside the LAN address, so it works with no network at all; a preview started with no LAN interface now serves this computer alone instead of refusing to start.
