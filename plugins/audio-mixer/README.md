# estella-plugin-audio-mixer

The project's audio mixer, as an editor panel: one strip per bus with a fader,
mute, insert effects and ducking.

**Ships with the Estella editor** — open it from **Window ▸ Audio Mixer**. It is
listed in the Plugins panel like any other, because it is one.

```bash
# Only if you want to pin your own build of it in a project
npm install estella-plugin-audio-mixer
```

A project that depends on the package, or drops a copy in
`.esengine/plugins/`, shadows the shipped one — that is how you run a fork.

## What it edits

`features.audio` in `project.esproject`: the same block Play and every export
read, so a level you set here is the level the game ships with. Writes go
through the editor's own project-settings door, which persists and live-applies
in one step — a fader is audible while you drag it.

## Built on the public API

Nothing here reaches into the editor. It uses `ctx.panels.register` to mount a
React root, `ctx.project.feature` / `setFeature` (hence the `fs:project`
capability), `ctx.events.on('projectChanged')` to re-render, and `ctx.locale`
for its own bilingual strings. It brings its own CSS, written against the
editor's theme *variables* rather than its class names — those are internal, and
styling against them would break the day one is renamed.

The merge between "what the project declared" and "what the engine always has"
is a pure function in `src/model.ts`, tested on its own.

Apache-2.0.
