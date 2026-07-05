import { defineComponent } from 'esengine';

// The project's declaration entry (src/components.ts): user component/tag
// definitions only — no systems, no createWebApp. The editor extracts schemas
// from here so the inspector knows their fields without running project code.
// (StateMachineAgent / NavAgent are engine built-ins, so they aren't declared.)

/** Marks the WASD-controlled player and carries its move speed. */
export const PlayerControl = defineComponent('PlayerControl', {
    speed: 240,
});
