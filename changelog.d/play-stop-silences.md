---
section: Fixed
commits:
  - fix(app): a runtime still loading when its App quits stops instead of running it, and leaving play mode ends the session's sound
  - fix(editor): a play realm runs one game at a time, so Stop ends the music a Play handed over mid-load had started
---
**Stopping a game in the editor stops its music and sound effects.** A Play handed to the editor's play realm while the
previous one was still loading built a second game beside the first, and the first kept playing where Stop could not
reach it, until the editor was restarted (#227). The realm now gives every Play, Stop and code reload a claim that the
next one retires: a request that is no longer the latest ends the game it built, and Stop always ends the one running.
`App.signal` is aborted when an App quits, and the runtime's start-up stops on it rather than starting a released App's
loop; an edit world leaving play mode also stops the sources and music the session started.
