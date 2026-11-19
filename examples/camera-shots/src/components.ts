import { defineComponent } from 'esengine';

// The project's declaration entry (src/components.ts): user components only — no
// systems. The editor reads their fields from here. Every camera part this example
// shows (CameraDolly, LookAtTarget, CameraNoise, CameraBrain) is an engine
// component, set up in the scene.

/** Which key picks this camera: 1, 2 or 3. The shot director raises its priority. */
export const Shot = defineComponent('Shot', {
    key: 1,
});
