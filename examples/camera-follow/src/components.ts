import { defineComponent, defineTag } from 'esengine';

// The project's declaration entry (src/components.ts): user component/tag
// definitions only — no systems. The editor extracts schemas from here so the
// inspector knows their fields without running project code. (Camera and
// FollowTarget are engine built-ins, so they aren't declared here.)

/** Marks the WASD-controlled player square and carries its move speed. */
export const Player = defineComponent('Player', {
    speed: 420,
});

/** Marks the fixed wide-angle camera that key 2 blends the view to. */
export const OverviewCam = defineTag('OverviewCam');
