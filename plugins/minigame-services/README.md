# estella-plugin-minigame-services

The mini-game host's **share sheet** and **in-game purchase**, as Estella
services. Both used to ship inside the engine; they live here because most games
never open either, and because a service is exactly the shape a plugin should be.

```bash
npm install estella-plugin-minigame-services
```

```ts title="src/main.ts"
import { addPlugin } from 'esengine';
import { miniGameServicesPlugin, Share, Payment } from 'estella-plugin-minigame-services';

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

## Built on the public API

Only `esengine`'s public surface: `defineResource`, the `Plugin` interface, and
the host capability functions (`platformShare`, `platformCanShare`,
`platformOnShareRequest`, `platformCanPay`, `platformRequestPayment`). Declare
`esengine` a **peer** dependency if you write one of these — a copy vendored
inside the package would be a second engine whose resources nothing can read.

Apache-2.0.
