---
section: Added
commits:
  - feat(export): a project chooses when its playable ad tells the network it is ready - when the game starts running, as before, or once the engine's ident has gone (packaging.platforms.playable.ready)
  - feat(settings): the engine intro and a playable's ready timing are project settings - Start screen has an Engine intro switch, on unless the project turned it off, and the playable page asks whether to tell the ad network it is ready when the game starts or after the intro
---
**A playable ad can wait for the engine's ident before telling its ad network it is ready.** `packaging.platforms.playable.ready` is `start` by default: the network hears it the moment the game starts running, which, now that the game boots behind the ident, can be while the ident still covers it. Set it to `after-ident` and the network is told once the ident has gone and the game is what is on screen. With the ident turned off (`packaging.splash.ident: false`), both say ready when the game starts. Project Settings shows both: Engine intro under Start screen, and the ready timing on the playable target's page.
