// ESEngine ECS Unit Tests
// Simple test framework without external dependencies

#include <esengine/ESEngine.hpp>
#include <esengine/ecs/TransformSystem.hpp>
#include <iostream>
#include <cassert>

// Simple test macros
#define TEST(name) void test_##name()
#define RUN_TEST(name) do { \
    std::cout << "Running " #name "... "; \
    test_##name(); \
    std::cout << "PASSED" << std::endl; \
    passed++; \
} while(0)

#define ASSERT_TRUE(cond) do { \
    if (!(cond)) { \
        std::cerr << "FAILED: " #cond << " at line " << __LINE__ << std::endl; \
        failed++; \
        return; \
    } \
} while(0)

#define ASSERT_EQ(a, b) ASSERT_TRUE((a) == (b))
#define ASSERT_NE(a, b) ASSERT_TRUE((a) != (b))

static int passed = 0;
static int failed = 0;

// Test components (local to this file to avoid conflicts)
namespace test {

struct Position {
    float x = 0.0f;
    float y = 0.0f;
    Position() = default;
    Position(float x_, float y_) : x(x_), y(y_) {}
};

struct Velocity {
    float dx = 0.0f;
    float dy = 0.0f;
    Velocity() = default;
    Velocity(float dx_, float dy_) : dx(dx_), dy(dy_) {}
};

struct Health {
    int value = 0;
    Health() = default;
    Health(int v) : value(v) {}
};

}  // namespace test

// Tests
TEST(entity_creation) {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();
    esengine::Entity e3 = registry.create();

    ASSERT_TRUE(registry.valid(e1));
    ASSERT_TRUE(registry.valid(e2));
    ASSERT_TRUE(registry.valid(e3));
    ASSERT_NE(e1, e2);
    ASSERT_NE(e2, e3);
    ASSERT_EQ(registry.entityCount(), 3u);
}

TEST(entity_destruction) {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();

    registry.destroy(e1);

    ASSERT_TRUE(!registry.valid(e1));
    ASSERT_TRUE(registry.valid(e2));
    ASSERT_EQ(registry.entityCount(), 1u);
}

TEST(entity_recycling) {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    registry.destroy(e1);
    esengine::Entity e2 = registry.create();

    // e2 should reuse e1's ID
    ASSERT_EQ(e1, e2);
    ASSERT_TRUE(registry.valid(e2));
}

TEST(component_emplace) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& pos = registry.emplace<test::Position>(entity, 10.0f, 20.0f);

    ASSERT_TRUE(registry.has<test::Position>(entity));
    ASSERT_EQ(pos.x, 10.0f);
    ASSERT_EQ(pos.y, 20.0f);
}

TEST(component_get) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();
    registry.emplace<test::Position>(entity, 5.0f, 15.0f);

    auto& pos = registry.get<test::Position>(entity);

    ASSERT_EQ(pos.x, 5.0f);
    ASSERT_EQ(pos.y, 15.0f);

    // Modify through reference
    pos.x = 100.0f;
    ASSERT_EQ(registry.get<test::Position>(entity).x, 100.0f);
}

TEST(component_remove) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();
    registry.emplace<test::Position>(entity, 1.0f, 2.0f);

    ASSERT_TRUE(registry.has<test::Position>(entity));

    registry.remove<test::Position>(entity);

    ASSERT_TRUE(!registry.has<test::Position>(entity));
}

TEST(component_try_get) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    ASSERT_TRUE(registry.tryGet<test::Position>(entity) == nullptr);

    registry.emplace<test::Position>(entity, 1.0f, 2.0f);

    auto* pos = registry.tryGet<test::Position>(entity);
    ASSERT_TRUE(pos != nullptr);
    ASSERT_EQ(pos->x, 1.0f);
}

TEST(multiple_components) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    registry.emplace<test::Position>(entity, 1.0f, 2.0f);
    registry.emplace<test::Velocity>(entity, 3.0f, 4.0f);
    registry.emplace<test::Health>(entity, 100);

    ASSERT_TRUE(registry.has<test::Position>(entity));
    ASSERT_TRUE(registry.has<test::Velocity>(entity));
    ASSERT_TRUE(registry.has<test::Health>(entity));

    ASSERT_EQ(registry.get<test::Position>(entity).x, 1.0f);
    ASSERT_EQ(registry.get<test::Velocity>(entity).dx, 3.0f);
    ASSERT_EQ(registry.get<test::Health>(entity).value, 100);
}

TEST(view_single_component) {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();
    esengine::Entity e3 = registry.create();

    registry.emplace<test::Position>(e1, 1.0f, 1.0f);
    registry.emplace<test::Position>(e2, 2.0f, 2.0f);
    // e3 has no Position

    auto view = registry.view<test::Position>();
    int count = 0;
    for (auto entity : view) {
        (void)entity;
        count++;
    }

    ASSERT_EQ(count, 2);
}

TEST(view_multiple_components) {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();
    esengine::Entity e3 = registry.create();

    registry.emplace<test::Position>(e1, 1.0f, 1.0f);
    registry.emplace<test::Velocity>(e1, 1.0f, 1.0f);

    registry.emplace<test::Position>(e2, 2.0f, 2.0f);
    // e2 has no Velocity

    registry.emplace<test::Velocity>(e3, 3.0f, 3.0f);
    // e3 has no Position

    auto view = registry.view<test::Position, test::Velocity>();
    int count = 0;
    for (auto entity : view) {
        (void)entity;
        count++;
    }

    ASSERT_EQ(count, 1);  // Only e1 has both
}

TEST(view_each) {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();

    registry.emplace<test::Position>(e1, 10.0f, 20.0f);
    registry.emplace<test::Velocity>(e1, 1.0f, 2.0f);

    registry.emplace<test::Position>(e2, 30.0f, 40.0f);
    registry.emplace<test::Velocity>(e2, 3.0f, 4.0f);

    float totalX = 0.0f;
    auto view = registry.view<test::Position, test::Velocity>();
    view.each([&totalX](esengine::Entity entity, test::Position& pos, test::Velocity& vel) {
        (void)entity;
        pos.x += vel.dx;
        totalX += pos.x;
    });

    ASSERT_EQ(registry.get<test::Position>(e1).x, 11.0f);
    ASSERT_EQ(registry.get<test::Position>(e2).x, 33.0f);
    ASSERT_EQ(totalX, 44.0f);
}

TEST(has_all_any) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    registry.emplace<test::Position>(entity, 0.0f, 0.0f);
    registry.emplace<test::Velocity>(entity, 0.0f, 0.0f);

    ASSERT_TRUE((registry.hasAll<test::Position, test::Velocity>(entity)));
    ASSERT_TRUE(!(registry.hasAll<test::Position, test::Health>(entity)));
    ASSERT_TRUE((registry.hasAny<test::Position, test::Health>(entity)));
    ASSERT_TRUE(!(registry.hasAny<test::Health>(entity)));
}

TEST(clear_registry) {
    esengine::ecs::Registry registry;

    for (int i = 0; i < 10; ++i) {
        esengine::Entity e = registry.create();
        registry.emplace<test::Position>(e, static_cast<float>(i), 0.0f);
    }

    ASSERT_EQ(registry.entityCount(), 10u);

    registry.clear();

    ASSERT_EQ(registry.entityCount(), 0u);

    // Should be able to create new entities after clear
    esengine::Entity e = registry.create();
    ASSERT_TRUE(registry.valid(e));
}

TEST(sparse_set_basic) {
    esengine::ecs::SparseSet<test::Position> set;

    esengine::Entity e1 = 0;
    esengine::Entity e2 = 5;
    esengine::Entity e3 = 100;

    set.emplace(e1, 1.0f, 1.0f);
    set.emplace(e2, 2.0f, 2.0f);
    set.emplace(e3, 3.0f, 3.0f);

    ASSERT_TRUE(set.contains(e1));
    ASSERT_TRUE(set.contains(e2));
    ASSERT_TRUE(set.contains(e3));
    ASSERT_TRUE(!set.contains(50));

    ASSERT_EQ(set.get(e1).x, 1.0f);
    ASSERT_EQ(set.get(e2).x, 2.0f);
    ASSERT_EQ(set.get(e3).x, 3.0f);

    ASSERT_EQ(set.size(), 3u);
}

TEST(sparse_set_remove) {
    esengine::ecs::SparseSet<test::Position> set;

    esengine::Entity e1 = 0;
    esengine::Entity e2 = 1;
    esengine::Entity e3 = 2;

    set.emplace(e1, 1.0f, 1.0f);
    set.emplace(e2, 2.0f, 2.0f);
    set.emplace(e3, 3.0f, 3.0f);

    set.remove(e2);

    ASSERT_TRUE(set.contains(e1));
    ASSERT_TRUE(!set.contains(e2));
    ASSERT_TRUE(set.contains(e3));

    // Values should still be correct after swap-and-pop
    ASSERT_EQ(set.get(e1).x, 1.0f);
    ASSERT_EQ(set.get(e3).x, 3.0f);

    ASSERT_EQ(set.size(), 2u);
}

// =============================================================================
// Modern Component Tests
// =============================================================================

TEST(local_transform_default) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& local = registry.emplace<esengine::ecs::LocalTransform>(entity);

    ASSERT_EQ(local.position.x, 0.0f);
    ASSERT_EQ(local.position.y, 0.0f);
    ASSERT_EQ(local.position.z, 0.0f);
    ASSERT_EQ(local.rotation.w, 1.0f);  // Identity quaternion
    ASSERT_EQ(local.scale.x, 1.0f);
}

TEST(local_transform_with_position) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& local = registry.emplace<esengine::ecs::LocalTransform>(
        entity, glm::vec3(10.0f, 20.0f, 30.0f));

    ASSERT_EQ(local.position.x, 10.0f);
    ASSERT_EQ(local.position.y, 20.0f);
    ASSERT_EQ(local.position.z, 30.0f);
}

TEST(local_transform_with_rotation) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    glm::quat rotation = glm::angleAxis(glm::radians(90.0f), glm::vec3(0, 1, 0));
    auto& local = registry.emplace<esengine::ecs::LocalTransform>(
        entity, glm::vec3(0.0f), rotation);

    ASSERT_TRUE(esengine::math::approxEqual(local.rotation.y, rotation.y, 0.001f));
}

TEST(hierarchy_parent_child) {
    esengine::ecs::Registry registry;

    esengine::Entity parent = registry.create();
    esengine::Entity child = registry.create();

    registry.emplace<esengine::ecs::LocalTransform>(parent, glm::vec3(10.0f, 0.0f, 0.0f));
    registry.emplace<esengine::ecs::LocalTransform>(child, glm::vec3(5.0f, 0.0f, 0.0f));

    esengine::ecs::setParent(registry, child, parent);

    ASSERT_TRUE(registry.has<esengine::ecs::Parent>(child));
    ASSERT_TRUE(registry.has<esengine::ecs::Children>(parent));

    ASSERT_EQ(registry.get<esengine::ecs::Parent>(child).entity, parent);
    ASSERT_EQ(registry.get<esengine::ecs::Children>(parent).entities.size(), 1u);
    ASSERT_EQ(registry.get<esengine::ecs::Children>(parent).entities[0], child);
}

TEST(hierarchy_depth) {
    esengine::ecs::Registry registry;

    esengine::Entity grandparent = registry.create();
    esengine::Entity parent = registry.create();
    esengine::Entity child = registry.create();

    registry.emplace<esengine::ecs::LocalTransform>(grandparent);
    registry.emplace<esengine::ecs::LocalTransform>(parent);
    registry.emplace<esengine::ecs::LocalTransform>(child);

    esengine::ecs::setParent(registry, parent, grandparent);
    esengine::ecs::setParent(registry, child, parent);

    ASSERT_EQ(registry.get<esengine::ecs::HierarchyDepth>(parent).depth, 1u);
    ASSERT_EQ(registry.get<esengine::ecs::HierarchyDepth>(child).depth, 2u);
}

TEST(hierarchy_get_root) {
    esengine::ecs::Registry registry;

    esengine::Entity root = registry.create();
    esengine::Entity middle = registry.create();
    esengine::Entity leaf = registry.create();

    registry.emplace<esengine::ecs::LocalTransform>(root);
    registry.emplace<esengine::ecs::LocalTransform>(middle);
    registry.emplace<esengine::ecs::LocalTransform>(leaf);

    esengine::ecs::setParent(registry, middle, root);
    esengine::ecs::setParent(registry, leaf, middle);

    ASSERT_EQ(esengine::ecs::getRoot(registry, leaf), root);
    ASSERT_EQ(esengine::ecs::getRoot(registry, middle), root);
    ASSERT_EQ(esengine::ecs::getRoot(registry, root), root);
}

TEST(hierarchy_is_descendant) {
    esengine::ecs::Registry registry;

    esengine::Entity root = registry.create();
    esengine::Entity child = registry.create();
    esengine::Entity grandchild = registry.create();
    esengine::Entity unrelated = registry.create();

    registry.emplace<esengine::ecs::LocalTransform>(root);
    registry.emplace<esengine::ecs::LocalTransform>(child);
    registry.emplace<esengine::ecs::LocalTransform>(grandchild);
    registry.emplace<esengine::ecs::LocalTransform>(unrelated);

    esengine::ecs::setParent(registry, child, root);
    esengine::ecs::setParent(registry, grandchild, child);

    ASSERT_TRUE(esengine::ecs::isDescendantOf(registry, child, root));
    ASSERT_TRUE(esengine::ecs::isDescendantOf(registry, grandchild, root));
    ASSERT_TRUE(esengine::ecs::isDescendantOf(registry, grandchild, child));
    ASSERT_TRUE(!esengine::ecs::isDescendantOf(registry, root, child));
    ASSERT_TRUE(!esengine::ecs::isDescendantOf(registry, unrelated, root));
}

TEST(sprite_with_texture_handle) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    esengine::resource::TextureHandle texHandle(42);
    auto& sprite = registry.emplace<esengine::ecs::Sprite>(entity, texHandle);

    ASSERT_TRUE(sprite.texture.isValid());
    ASSERT_EQ(sprite.texture.id(), 42u);
    ASSERT_EQ(sprite.color.r, 1.0f);
}

TEST(camera_default) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& camera = registry.emplace<esengine::ecs::Camera>(entity);

    ASSERT_EQ(camera.projectionType, esengine::ecs::ProjectionType::Perspective);
    ASSERT_EQ(camera.fov, 60.0f);
    ASSERT_EQ(camera.nearPlane, 0.1f);
    ASSERT_TRUE(!camera.isActive);
}

TEST(uuid_component) {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& uuid = registry.emplace<esengine::ecs::UUID>(entity, 0x12345678ABCDEF00ULL);

    ASSERT_EQ(uuid.value, 0x12345678ABCDEF00ULL);

    esengine::ecs::UUID other(0x12345678ABCDEF00ULL);
    ASSERT_TRUE(uuid == other);
}

int main() {
    std::cout << "ESEngine ECS Unit Tests" << std::endl;
    std::cout << "========================" << std::endl;

    RUN_TEST(entity_creation);
    RUN_TEST(entity_destruction);
    RUN_TEST(entity_recycling);
    RUN_TEST(component_emplace);
    RUN_TEST(component_get);
    RUN_TEST(component_remove);
    RUN_TEST(component_try_get);
    RUN_TEST(multiple_components);
    RUN_TEST(view_single_component);
    RUN_TEST(view_multiple_components);
    RUN_TEST(view_each);
    RUN_TEST(has_all_any);
    RUN_TEST(clear_registry);
    RUN_TEST(sparse_set_basic);
    RUN_TEST(sparse_set_remove);

    // Modern component tests
    RUN_TEST(local_transform_default);
    RUN_TEST(local_transform_with_position);
    RUN_TEST(local_transform_with_rotation);
    RUN_TEST(hierarchy_parent_child);
    RUN_TEST(hierarchy_depth);
    RUN_TEST(hierarchy_get_root);
    RUN_TEST(hierarchy_is_descendant);
    RUN_TEST(sprite_with_texture_handle);
    RUN_TEST(camera_default);
    RUN_TEST(uuid_component);

    std::cout << "========================" << std::endl;
    std::cout << "Results: " << passed << " passed, " << failed << " failed" << std::endl;

    return failed > 0 ? 1 : 0;
}
