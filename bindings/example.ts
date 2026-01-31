/**
 * @file    example.ts
 * @brief   Example usage of ESEngine ECS API
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import createModule from './esengine';
import {
    App,
    Schedule,
    StartupSystem,
    UpdateSystem,
    LocalTransform,
    Sprite
} from './App';

// =============================================================================
// Systems
// =============================================================================

class SpawnSystem extends StartupSystem {
    onStart(): void {
        this.world_.spawn()
            .with(LocalTransform, {
                position: { x: 400, y: 300, z: 0 }
            })
            .with(Sprite, {
                color: { x: 1, y: 0, z: 0, w: 1 },
                size: { x: 64, y: 64 }
            });
    }
}

class MovementSystem extends UpdateSystem {
    onUpdate(): void {
        for (const [_, transform] of this.world_.query(LocalTransform)) {
            transform.position.x += Math.sin(this.time_.elapsed * 2) * 50 * this.time_.delta;
        }
    }
}

class RenderSystem extends UpdateSystem {
    onUpdate(): void {
        for (const [entity, transform, sprite] of this.world_.query(LocalTransform, Sprite)) {
            console.log(`Entity ${entity}: pos=(${transform.position.x.toFixed(1)}, ${transform.position.y.toFixed(1)}), layer=${sprite.layer}`);
        }
    }
}

async function main(): Promise<void> {
    const module = await createModule();

    const app = new App(module, {
        title: 'ECS Example',
        width: 800,
        height: 600
    });

    app.addStartupSystem(new SpawnSystem())
       .addUpdateSystem(new MovementSystem())
       .addSystem(Schedule.Render, new RenderSystem());

    app.run();
}

main().catch(console.error);
