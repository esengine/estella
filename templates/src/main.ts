/**
 * ESEngine Project Entry Point
 *
 * This file is the main entry point for your game logic.
 * Press F5 in the editor to run, or use Web Preview for browser testing.
 */
import {
    type ESEngineModule,
    App,
    createWebApp,
    defineSystem,
    Schedule,
    Commands,
    LocalTransform,
    Sprite,
    Camera,
    Canvas,
    Res,
    Time,
    Query,
    Mut,
    type Entity
} from 'esengine';

// =============================================================================
// Main Entry Point
// =============================================================================

export async function main(Module: ESEngineModule): Promise<void> {
    console.log('ESEngine starting...');

    // Create the app with WASM module (handles renderer init + render loop)
    const app = createWebApp(Module);

    // Add startup system - runs once at beginning
    app.addSystemToSchedule(Schedule.Startup, defineSystem(
        [Commands()],
        (cmds) => {
            console.log('Startup: Creating entities...');

            // Create camera
            const camera = cmds.spawn()
                .insert(Camera, {
                    projectionType: 1, // Orthographic
                    fov: 60,
                    orthoSize: 400,
                    nearPlane: 0.1,
                    farPlane: 1000,
                    aspectRatio: 1,
                    isActive: true,
                    priority: 0
                })
                .insert(LocalTransform, {
                    position: { x: 0, y: 0, z: 10 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                })
                .id();

            // Create a test sprite
            const sprite = cmds.spawn()
                .insert(Sprite, {
                    texture: 0,
                    color: { r: 1, g: 0.5, b: 0.2, a: 1 },
                    size: { x: 100, y: 100 },
                    uvOffset: { x: 0, y: 0 },
                    uvScale: { x: 1, y: 1 },
                    layer: 0,
                    flipX: false,
                    flipY: false
                })
                .insert(LocalTransform, {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                })
                .id();

            console.log(`Created camera: ${camera}, sprite: ${sprite}`);
        }
    ));

    // Add update system - runs every frame
    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [Res(Time), Query(LocalTransform, Sprite)],
        (time, query) => {
            for (const [entity, transform, sprite] of query) {
                // Move the sprite in a circle
                transform.position.x = Math.sin(time.elapsed) * 100;
                transform.position.y = Math.cos(time.elapsed) * 100;
            }
        }
    ));

    // Start the game loop
    console.log('Starting game loop...');
    app.run();
}
