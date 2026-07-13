import { defineComponent } from 'esengine';

// The project's declaration entry (src/components.ts): user component/tag
// definitions only — no systems, no createWebApp. The editor extracts schemas
// from here so the inspector knows their fields without running project code.
// (StateMachineAgent / TimelinePlayer are engine built-ins, so they aren't
// declared.)

/** Marks the arrow/WASD-controlled hero and carries its move speed. */
export const HeroControl = defineComponent('HeroControl', {
    speed: 260,
});
