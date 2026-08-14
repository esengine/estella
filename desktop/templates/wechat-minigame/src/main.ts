import { addStartupSystem, defineSystem, GetWorld } from 'esengine';

/**
 * A mini-game host starts the game inside its own shell: no window to size, no
 * URL to read, and a launch payload instead of a query string. Nothing here
 * needs it yet — this is where it lands when it does.
 */
const bootSystem = defineSystem(
    [GetWorld()],
    () => {
        console.log('[wechat] booted — Build > Package builds the mini-game bundle.');
    },
    { name: 'BootSystem' },
);

addStartupSystem(bootSystem);
