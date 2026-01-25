// ESEngine ECS Unit Tests
// Simple test framework without external dependencies

#include <esengine/ESEngine.hpp>
#include <iostream>
#include <cassert>

using namespace esengine;
using namespace esengine::ecs;

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

// Test components
struct Position {
    float x, y;
};

struct Velocity {
    float dx, dy;
};

struct Health {
    int value;
};

// Tests
TEST(entity_creation) {
    Registry registry;

    Entity e1 = registry.create();
    Entity e2 = registry.create();
    Entity e3 = registry.create();

    ASSERT_TRUE(registry.valid(e1));
    ASSERT_TRUE(registry.valid(e2));
    ASSERT_TRUE(registry.valid(e3));
    ASSERT_NE(e1, e2);
    ASSERT_NE(e2, e3);
    ASSERT_EQ(registry.entityCount(), 3u);
}

TEST(entity_destruction) {
    Registry registry;

    Entity e1 = registry.create();
    Entity e2 = registry.create();

    registry.destroy(e1);

    ASSERT_TRUE(!registry.valid(e1));
    ASSERT_TRUE(registry.valid(e2));
    ASSERT_EQ(registry.entityCount(), 1u);
}

TEST(entity_recycling) {
    Registry registry;

    Entity e1 = registry.create();
    registry.destroy(e1);
    Entity e2 = registry.create();

    // e2 should reuse e1's ID
    ASSERT_EQ(e1, e2);
    ASSERT_TRUE(registry.valid(e2));
}

TEST(component_emplace) {
    Registry registry;
    Entity entity = registry.create();

    auto& pos = registry.emplace<Position>(entity, 10.0f, 20.0f);

    ASSERT_TRUE(registry.has<Position>(entity));
    ASSERT_EQ(pos.x, 10.0f);
    ASSERT_EQ(pos.y, 20.0f);
}

TEST(component_get) {
    Registry registry;
    Entity entity = registry.create();
    registry.emplace<Position>(entity, 5.0f, 15.0f);

    auto& pos = registry.get<Position>(entity);

    ASSERT_EQ(pos.x, 5.0f);
    ASSERT_EQ(pos.y, 15.0f);

    // Modify through reference
    pos.x = 100.0f;
    ASSERT_EQ(registry.get<Position>(entity).x, 100.0f);
}

TEST(component_remove) {
    Registry registry;
    Entity entity = registry.create();
    registry.emplace<Position>(entity, 1.0f, 2.0f);

    ASSERT_TRUE(registry.has<Position>(entity));

    registry.remove<Position>(entity);

    ASSERT_TRUE(!registry.has<Position>(entity));
}

TEST(component_try_get) {
    Registry registry;
    Entity entity = registry.create();

    ASSERT_TRUE(registry.tryGet<Position>(entity) == nullptr);

    registry.emplace<Position>(entity, 1.0f, 2.0f);

    auto* pos = registry.tryGet<Position>(entity);
    ASSERT_TRUE(pos != nullptr);
    ASSERT_EQ(pos->x, 1.0f);
}

TEST(multiple_components) {
    Registry registry;
    Entity entity = registry.create();

    registry.emplace<Position>(entity, 1.0f, 2.0f);
    registry.emplace<Velocity>(entity, 3.0f, 4.0f);
    registry.emplace<Health>(entity, 100);

    ASSERT_TRUE(registry.has<Position>(entity));
    ASSERT_TRUE(registry.has<Velocity>(entity));
    ASSERT_TRUE(registry.has<Health>(entity));

    ASSERT_EQ(registry.get<Position>(entity).x, 1.0f);
    ASSERT_EQ(registry.get<Velocity>(entity).dx, 3.0f);
    ASSERT_EQ(registry.get<Health>(entity).value, 100);
}

TEST(view_single_component) {
    Registry registry;

    Entity e1 = registry.create();
    Entity e2 = registry.create();
    Entity e3 = registry.create();

    registry.emplace<Position>(e1, 1.0f, 1.0f);
    registry.emplace<Position>(e2, 2.0f, 2.0f);
    // e3 has no Position

    auto view = registry.view<Position>();
    int count = 0;
    for (auto entity : view) {
        (void)entity;
        count++;
    }

    ASSERT_EQ(count, 2);
}

TEST(view_multiple_components) {
    Registry registry;

    Entity e1 = registry.create();
    Entity e2 = registry.create();
    Entity e3 = registry.create();

    registry.emplace<Position>(e1, 1.0f, 1.0f);
    registry.emplace<Velocity>(e1, 1.0f, 1.0f);

    registry.emplace<Position>(e2, 2.0f, 2.0f);
    // e2 has no Velocity

    registry.emplace<Velocity>(e3, 3.0f, 3.0f);
    // e3 has no Position

    auto view = registry.view<Position, Velocity>();
    int count = 0;
    for (auto entity : view) {
        (void)entity;
        count++;
    }

    ASSERT_EQ(count, 1);  // Only e1 has both
}

TEST(view_each) {
    Registry registry;

    Entity e1 = registry.create();
    Entity e2 = registry.create();

    registry.emplace<Position>(e1, 10.0f, 20.0f);
    registry.emplace<Velocity>(e1, 1.0f, 2.0f);

    registry.emplace<Position>(e2, 30.0f, 40.0f);
    registry.emplace<Velocity>(e2, 3.0f, 4.0f);

    float totalX = 0.0f;
    auto view = registry.view<Position, Velocity>();
    view.each([&totalX](Entity entity, Position& pos, Velocity& vel) {
        (void)entity;
        pos.x += vel.dx;
        totalX += pos.x;
    });

    ASSERT_EQ(registry.get<Position>(e1).x, 11.0f);
    ASSERT_EQ(registry.get<Position>(e2).x, 33.0f);
    ASSERT_EQ(totalX, 44.0f);
}

TEST(has_all_any) {
    Registry registry;
    Entity entity = registry.create();

    registry.emplace<Position>(entity, 0.0f, 0.0f);
    registry.emplace<Velocity>(entity, 0.0f, 0.0f);

    ASSERT_TRUE(registry.hasAll<Position, Velocity>(entity));
    ASSERT_TRUE(!registry.hasAll<Position, Health>(entity));
    ASSERT_TRUE(registry.hasAny<Position, Health>(entity));
    ASSERT_TRUE(!registry.hasAny<Health>(entity));
}

TEST(clear_registry) {
    Registry registry;

    for (int i = 0; i < 10; ++i) {
        Entity e = registry.create();
        registry.emplace<Position>(e, static_cast<float>(i), 0.0f);
    }

    ASSERT_EQ(registry.entityCount(), 10u);

    registry.clear();

    ASSERT_EQ(registry.entityCount(), 0u);

    // Should be able to create new entities after clear
    Entity e = registry.create();
    ASSERT_TRUE(registry.valid(e));
}

TEST(sparse_set_basic) {
    SparseSet<Position> set;

    Entity e1 = 0;
    Entity e2 = 5;
    Entity e3 = 100;

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
    SparseSet<Position> set;

    Entity e1 = 0;
    Entity e2 = 1;
    Entity e3 = 2;

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

    std::cout << "========================" << std::endl;
    std::cout << "Results: " << passed << " passed, " << failed << " failed" << std::endl;

    return failed > 0 ? 1 : 0;
}
