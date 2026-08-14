# estella-plugin-minigame-services

The mini-game host's **share sheet**, **in-game purchase** and **friends
leaderboard**, as Estella services. All three used to ship inside the engine;
they live here because most games open none of them, and because a service is
exactly the shape a plugin should be.

```bash
npm install estella-plugin-minigame-services
```

```ts title="src/main.ts"
import { addPlugin } from 'esengine';
import { miniGameServicesPlugin, Share, Payment, Leaderboard } from 'estella-plugin-minigame-services';

addPlugin(miniGameServicesPlugin);
```

## Share

```ts
const share = app.getResource(Share);

// Hide your share button where the host has no sheet (web and native).
if (share.available) showShareButton();

// The card is asked for at SHARE time, so it can carry live state.
share.setShareCard(() => ({ title: `I scored ${score}` }));
share.share();
```

Setting the card also answers the host's OWN share menu — the passive surface a
player reaches without touching your button.

## Payment

```ts
const pay = app.getResource(Payment);

// Answers for the DEVICE, not for the API: on WeChat, buying is Android-only.
// A shop reads this to stay closed rather than to open and fail.
if (!pay.available) return;

await pay.request({ quantity: 10 });
// Resolved means "the host says it completed" — go ASK your server what the
// player owns. A purchase the client believes in is one an attacker can claim.
```

Failures reject with the host's own message and `code`, untranslated: vendors
number them differently, and a mapping invented here would be a guess your game
then branches on.

## Leaderboard

A friends board has two halves in two JS runtimes, and this package is both.

**The game's half** asks for the board and wears its pixels:

```ts
const board = app.getResource(Leaderboard);

// Hide the button where the host has no open data context (web, native).
if (board.available) showLeaderboardButton();

board.submit(score);            // your own cloud row — the one write allowed here
board.show({ limit: 10 });      // a REQUEST to draw; no rows ever come back
uiVisual.texture = board.texture; // what it drew, as an engine texture handle
board.hide();
```

**The context's half** runs in the second runtime, which has no engine, no WebGL
and no DOM. The project owns that file; this package supplies what goes in it:

```ts title="open-data/index.ts"
import 'estella-plugin-minigame-services/open-data';
```

That directory is what the exporter bundles separately and names in `game.json`.
Without it the host has no context, and `available` says so rather than a board
failing on a device.

In the editor's play mode there is no host, so the editor stands in for one: it
runs **that same file** against an offscreen canvas and invented friends. So the
board you look at while building the panel is the one that ships, and nothing
here needs a rehearsal mode of its own.

## Built on the public API

Only `esengine`'s public surface: `defineResource`, the `Plugin` interface,
`createCanvasTexture`, and the host capability functions (`platformShare`,
`platformCanShare`, `platformOnShareRequest`, `platformCanPay`,
`platformRequestPayment`, `platformCanOpenData`, `platformOpenDataPostMessage`,
`platformOpenDataCanvas`, `platformSetCloudKeyValues`, `platformCreateCanvas`,
`platformDevicePixelRatio`). Declare `esengine` a **peer** dependency if you
write one of these — a copy vendored inside the package would be a second engine
whose resources nothing can read.

Apache-2.0.
