import { addSystemToSchedule, Schedule, defineSystem, Res, Input } from 'esengine';

/**
 * The call to action. Every ad network injects its own — MRAID's `mraid.open`,
 * or a global the host defines — so this is the ONE place to wire it, and it
 * says out loud when there is nothing to call rather than failing silently.
 */
function callToAction(): void {
    const open = (globalThis as { mraid?: { open?: (url: string) => void } }).mraid?.open;
    if (open) open('https://example.com/your-app');
    else console.log('[playable] CTA tapped — no network host, so nothing opened.');
}

// A playable is one gesture. Anywhere on the screen, any pointer.
const tapSystem = defineSystem(
    [Res(Input)],
    (input) => {
        if (input.isMouseButtonPressed(0)) callToAction();
    },
    { name: 'TapSystem' },
);

addSystemToSchedule(Schedule.Update, tapSystem);
