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
    defineTag,
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
    type Entity,
    Text,
    TextAlign,
    textPlugin,
    assetPlugin,
    Assets,
    INVALID_TEXTURE
} from 'esengine';

const Animated = defineTag('Animated');

// =============================================================================
// Main Entry Point
// =============================================================================

export async function main(Module: ESEngineModule): Promise<void> {
    console.log('ESEngine starting...');

    // Create the app with WASM module (handles renderer init + render loop)
    const app = createWebApp(Module);

    // Add plugins
    app.addPlugin(textPlugin);
    app.addPlugin(assetPlugin);

    // Get asset server and load texture
    const assets = app.getResource(Assets).server;
    const testIcon = await assets.loadTexture('assets/beer.png');
    console.log(`Loaded texture: ${testIcon.width}x${testIcon.height}, handle=${testIcon.handle}`);

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

            // Create a sprite with loaded texture
            const sprite = cmds.spawn()
                .insert(Animated)
                .insert(Sprite, {
                    texture: testIcon.handle,
                    color: { x: 1, y: 1, z: 1, w: 1 },
                    size: { x: testIcon.width, y: testIcon.height },
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

            const textEntity = cmds.spawn()
                .insert(Text, {
                    content: 'Hello ESEngine!',
                    fontFamily: 'Arial',
                    fontSize: 32,
                    color: { x: 1, y: 1, z: 1, w: 1 },
                    align: TextAlign.Center,
                    baseline: 0,
                    maxWidth: 0,
                    lineHeight: 1.2,
                    dirty: true
                })
                .insert(Sprite, {
                    texture: 0,
                    color: { x: 1, y: 1, z: 1, w: 1 },
                    size: { x: 200, y: 50 },
                    uvOffset: { x: 0, y: 0 },
                    uvScale: { x: 1, y: 1 },
                    layer: 10,
                    flipX: false,
                    flipY: false
                })
                .insert(LocalTransform, {
                    position: { x: 0, y: 150, z: 0 },
                    rotation: { w: 1, x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 }
                })
                .id();

            console.log(`Created camera: ${camera}, sprite: ${sprite}, text: ${textEntity}`);
        }
    ));

    app.addSystemToSchedule(Schedule.Update, defineSystem(
        [Res(Time), Query(Animated, Mut(LocalTransform))],
        (time, query) => {
            for (const [entity, _, transform] of query) {
                transform.position = {
                    x: Math.sin(time.elapsed) * 100,
                    y: Math.cos(time.elapsed) * 100,
                    z: 0
                };
            }
        }
    ));

    // Start the game loop
    console.log('Starting game loop...');
    app.run();
}
