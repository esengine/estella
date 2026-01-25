/**
 * ESEngine SDK - Hello Game Example
 *
 * A simple example demonstrating the TypeScript SDK usage.
 */

import {
  Application,
  Registry,
  Transform,
  Sprite,
  Velocity,
  TransformType,
  SpriteType,
  VelocityType,
  createTransform,
  createSprite,
  createVelocity,
  Renderer,
  Input,
  KeyCode,
  TouchType,
  TouchPoint,
  color,
  vec2,
} from '../../src/index';

/**
 * A simple game with a moving player square.
 */
class HelloGame extends Application {
  private player: number = 0;
  private speed: number = 200;

  protected onInit(): void {
    console.log('HelloGame initialized!');

    const registry = this.getRegistry();

    // Create player entity
    this.player = registry.create();

    // Add Transform component
    registry.emplace(
      this.player,
      TransformType,
      createTransform({ x: this.getWidth() / 2, y: this.getHeight() / 2 })
    );

    // Add Sprite component
    registry.emplace(
      this.player,
      SpriteType,
      createSprite(0, { color: { r: 1, g: 0.3, b: 0.3, a: 1 }, size: { x: 50, y: 50 } })
    );

    // Add Velocity component
    registry.emplace(this.player, VelocityType, createVelocity());

    // Create some background entities
    for (let i = 0; i < 5; i++) {
      const entity = registry.create();
      registry.emplace(
        entity,
        TransformType,
        createTransform({
          x: Math.random() * this.getWidth(),
          y: Math.random() * this.getHeight(),
        })
      );
      registry.emplace(
        entity,
        SpriteType,
        createSprite(0, {
          color: {
            r: Math.random() * 0.5 + 0.5,
            g: Math.random() * 0.5 + 0.5,
            b: Math.random() * 0.5 + 0.5,
            a: 0.8,
          },
          size: { x: 30 + Math.random() * 20, y: 30 + Math.random() * 20 },
        })
      );
    }

    // Set clear color
    Renderer.setClearColor(color(0.1, 0.1, 0.15, 1));
  }

  protected onUpdate(dt: number): void {
    const registry = this.getRegistry();

    // Handle input
    const velocity = registry.get<Velocity>(this.player, VelocityType);

    // Reset velocity
    velocity.linear.x = 0;
    velocity.linear.y = 0;

    // Keyboard input
    if (Input.isKeyDown(KeyCode.W) || Input.isKeyDown(KeyCode.Up)) {
      velocity.linear.y = -this.speed;
    }
    if (Input.isKeyDown(KeyCode.S) || Input.isKeyDown(KeyCode.Down)) {
      velocity.linear.y = this.speed;
    }
    if (Input.isKeyDown(KeyCode.A) || Input.isKeyDown(KeyCode.Left)) {
      velocity.linear.x = -this.speed;
    }
    if (Input.isKeyDown(KeyCode.D) || Input.isKeyDown(KeyCode.Right)) {
      velocity.linear.x = this.speed;
    }

    // Touch input - move towards touch position
    if (Input.isTouchDown()) {
      const touchPos = Input.getTouchPosition();
      const transform = registry.get<Transform>(this.player, TransformType);

      const dx = touchPos.x - transform.position.x;
      const dy = touchPos.y - transform.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 10) {
        velocity.linear.x = (dx / dist) * this.speed;
        velocity.linear.y = (dy / dist) * this.speed;
      }
    }

    // Quit on Escape
    if (Input.isKeyPressed(KeyCode.Escape)) {
      this.quit();
    }

    // Update positions based on velocity
    registry.view2<Transform, Velocity>(TransformType, VelocityType).each(
      (entity, transform, vel) => {
        transform.position.x += vel.linear.x * dt;
        transform.position.y += vel.linear.y * dt;

        // Keep player on screen
        if (entity === this.player) {
          transform.position.x = Math.max(
            25,
            Math.min(this.getWidth() - 25, transform.position.x)
          );
          transform.position.y = Math.max(
            25,
            Math.min(this.getHeight() - 25, transform.position.y)
          );
        }
      }
    );
  }

  protected onRender(): void {
    const registry = this.getRegistry();

    // Clear screen
    Renderer.clear();

    // Set up orthographic projection
    const projection = Renderer.createOrtho2D(
      this.getWidth() * this.getPlatform().getDevicePixelRatio(),
      this.getHeight() * this.getPlatform().getDevicePixelRatio()
    );
    Renderer.beginScene(projection);

    // Render all sprites
    registry.view2<Transform, Sprite>(TransformType, SpriteType).each(
      (entity, transform, sprite) => {
        const pos = vec2(
          transform.position.x * this.getPlatform().getDevicePixelRatio(),
          transform.position.y * this.getPlatform().getDevicePixelRatio()
        );
        const size = vec2(
          sprite.size.x * this.getPlatform().getDevicePixelRatio(),
          sprite.size.y * this.getPlatform().getDevicePixelRatio()
        );

        // Center the quad
        Renderer.drawQuad(
          { x: pos.x - size.x / 2, y: pos.y - size.y / 2 },
          size,
          sprite.color
        );
      }
    );

    Renderer.endScene();
  }

  protected onTouch(type: TouchType, point: TouchPoint): void {
    if (type === TouchType.Begin) {
      console.log(`Touch started at (${point.x}, ${point.y})`);
    }
  }

  protected onKey(key: KeyCode, pressed: boolean): void {
    if (pressed) {
      console.log(`Key pressed: ${key}`);
    }
  }

  protected onShutdown(): void {
    console.log('HelloGame shutdown');
  }
}

// Start the game with C++ WASM renderer
const game = new HelloGame({
  title: 'Hello ESEngine',
  width: 800,
  height: 600,
  canvas: 'canvas',  // Must match C++ selector "#canvas"
  wasmPath: './esengine.js',
});

game.run();
