#include <esengine/ESEngine.hpp>

using namespace esengine;
using namespace esengine::ecs;

// Simple movement system
class MovementSystem : public System {
public:
    void update(Registry& registry, f32 deltaTime) override {
        registry.each<LocalTransform, Velocity>([deltaTime](Entity entity, LocalTransform& transform, Velocity& velocity) {
            (void)entity;
            transform.position += velocity.linear * deltaTime;
        });
    }
};

// Demo application
class HelloTriangleApp : public Application {
public:
    HelloTriangleApp() : Application(createConfig()) {}

private:
    static ApplicationConfig createConfig() {
        ApplicationConfig config;
        config.title = "Hello Triangle";
        config.width = 800;
        config.height = 600;
        return config;
    }

protected:
    void onInit() override {
        ES_LOG_INFO("Hello Triangle initialized!");

        // Create some entities with the ECS
        auto& registry = getRegistry();

        // Create a triangle entity
        Entity triangle = registry.create();
        registry.emplace<LocalTransform>(triangle, glm::vec3(400.0f, 300.0f, 0.0f));
        registry.emplace<Name>(triangle, "Triangle");

        // Create moving entities
        for (int i = 0; i < 5; ++i) {
            Entity entity = registry.create();
            registry.emplace<LocalTransform>(entity, glm::vec3(100.0f + i * 120.0f, 100.0f, 0.0f));
            registry.emplace<Velocity>(entity, glm::vec3(50.0f * (i % 2 == 0 ? 1.0f : -1.0f), 0.0f, 0.0f));
            registry.emplace<Sprite>(entity);
        }

        ES_LOG_INFO("Created {} entities", registry.entityCount());
    }

    void onUpdate(f32 deltaTime) override {
        // Update entities manually (or use SystemGroup)
        auto& registry = getRegistry();
        registry.each<LocalTransform, Velocity>([deltaTime, this](LocalTransform& transform, Velocity& velocity) {
            transform.position += velocity.linear * deltaTime;

            // Bounce off edges
            if (transform.position.x < 0 || transform.position.x > getWidth()) {
                velocity.linear.x *= -1.0f;
            }
        });

        // Check for touch input
        if (getInput().isTouchPressed()) {
            auto pos = getInput().getTouchPosition();
            ES_LOG_DEBUG("Touch at ({}, {})", pos.x, pos.y);
        }

        // Check for key input
        if (getInput().isKeyPressed(KeyCode::Escape)) {
            quit();
        }
    }

    void onRender() override {
        auto& registry = getRegistry();
        auto& renderer = getRenderer();

        // Draw colored quads for entities with LocalTransform and Sprite
        auto view = registry.view<LocalTransform, Sprite>();
        for (auto entity : view) {
            auto& transform = view.get<LocalTransform>(entity);
            auto& sprite = view.get<Sprite>(entity);

            renderer.drawQuad(
                glm::vec2(transform.position.x, transform.position.y),
                sprite.size * 50.0f,
                sprite.color
            );
        }

        // Draw the main triangle
        auto triangleView = registry.view<LocalTransform, Name>();
        for (auto entity : triangleView) {
            auto& transform = triangleView.get<LocalTransform>(entity);
            auto& name = triangleView.get<Name>(entity);

            if (name.value == "Triangle") {
                renderer.drawQuad(
                    glm::vec2(transform.position.x, transform.position.y),
                    glm::vec2(100.0f, 100.0f),
                    glm::vec4(1.0f, 0.5f, 0.2f, 1.0f)
                );
            }
        }
    }

    void onTouch(TouchType type, const TouchPoint& point) override {
        if (type == TouchType::Begin) {
            // Create new entity at touch position
            auto& registry = getRegistry();
            Entity entity = registry.create();
            registry.emplace<Transform>(entity, glm::vec3(point.x, point.y, 0.0f));
            registry.emplace<Sprite>(entity);
            registry.emplace<Velocity>(entity, glm::vec3(
                (rand() % 200 - 100.0f),
                (rand() % 200 - 100.0f),
                0.0f
            ));
        }
    }

    void onShutdown() override {
        ES_LOG_INFO("Hello Triangle shutdown");
    }
};

// Entry point
#ifndef ES_PLATFORM_WEB
int main() {
    HelloTriangleApp app;
    app.run();
    return 0;
}
#else
// For web, entry is through the C API
ES_MAIN(HelloTriangleApp)
#endif
