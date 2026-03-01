#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/ESEngine.hpp>
#include <esengine/ecs/TransformSystem.hpp>

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

TEST_CASE("entity_creation") {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();
    esengine::Entity e3 = registry.create();

    CHECK(registry.valid(e1));
    CHECK(registry.valid(e2));
    CHECK(registry.valid(e3));
    CHECK_NE(e1, e2);
    CHECK_NE(e2, e3);
    CHECK_EQ(registry.entityCount(), 3u);
}

TEST_CASE("entity_destruction") {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();

    registry.destroy(e1);

    CHECK(!registry.valid(e1));
    CHECK(registry.valid(e2));
    CHECK_EQ(registry.entityCount(), 1u);
}

TEST_CASE("entity_recycling") {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    registry.destroy(e1);
    esengine::Entity e2 = registry.create();

    CHECK_EQ(e1, e2);
    CHECK(registry.valid(e2));
}

TEST_CASE("component_emplace") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& pos = registry.emplace<test::Position>(entity, 10.0f, 20.0f);

    CHECK(registry.has<test::Position>(entity));
    CHECK_EQ(pos.x, 10.0f);
    CHECK_EQ(pos.y, 20.0f);
}

TEST_CASE("component_get") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();
    registry.emplace<test::Position>(entity, 5.0f, 15.0f);

    auto& pos = registry.get<test::Position>(entity);

    CHECK_EQ(pos.x, 5.0f);
    CHECK_EQ(pos.y, 15.0f);

    pos.x = 100.0f;
    CHECK_EQ(registry.get<test::Position>(entity).x, 100.0f);
}

TEST_CASE("component_remove") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();
    registry.emplace<test::Position>(entity, 1.0f, 2.0f);

    CHECK(registry.has<test::Position>(entity));

    registry.remove<test::Position>(entity);

    CHECK(!registry.has<test::Position>(entity));
}

TEST_CASE("component_try_get") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    CHECK(registry.tryGet<test::Position>(entity) == nullptr);

    registry.emplace<test::Position>(entity, 1.0f, 2.0f);

    auto* pos = registry.tryGet<test::Position>(entity);
    CHECK(pos != nullptr);
    CHECK_EQ(pos->x, 1.0f);
}

TEST_CASE("multiple_components") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    registry.emplace<test::Position>(entity, 1.0f, 2.0f);
    registry.emplace<test::Velocity>(entity, 3.0f, 4.0f);
    registry.emplace<test::Health>(entity, 100);

    CHECK(registry.has<test::Position>(entity));
    CHECK(registry.has<test::Velocity>(entity));
    CHECK(registry.has<test::Health>(entity));

    CHECK_EQ(registry.get<test::Position>(entity).x, 1.0f);
    CHECK_EQ(registry.get<test::Velocity>(entity).dx, 3.0f);
    CHECK_EQ(registry.get<test::Health>(entity).value, 100);
}

TEST_CASE("view_single_component") {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();
    esengine::Entity e3 = registry.create();

    registry.emplace<test::Position>(e1, 1.0f, 1.0f);
    registry.emplace<test::Position>(e2, 2.0f, 2.0f);

    auto view = registry.view<test::Position>();
    int count = 0;
    for (auto entity : view) {
        (void)entity;
        count++;
    }

    CHECK_EQ(count, 2);
}

TEST_CASE("view_multiple_components") {
    esengine::ecs::Registry registry;

    esengine::Entity e1 = registry.create();
    esengine::Entity e2 = registry.create();
    esengine::Entity e3 = registry.create();

    registry.emplace<test::Position>(e1, 1.0f, 1.0f);
    registry.emplace<test::Velocity>(e1, 1.0f, 1.0f);

    registry.emplace<test::Position>(e2, 2.0f, 2.0f);

    registry.emplace<test::Velocity>(e3, 3.0f, 3.0f);

    auto view = registry.view<test::Position, test::Velocity>();
    int count = 0;
    for (auto entity : view) {
        (void)entity;
        count++;
    }

    CHECK_EQ(count, 1);
}

TEST_CASE("view_each") {
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

    CHECK_EQ(registry.get<test::Position>(e1).x, 11.0f);
    CHECK_EQ(registry.get<test::Position>(e2).x, 33.0f);
    CHECK_EQ(totalX, 44.0f);
}

TEST_CASE("has_all_any") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    registry.emplace<test::Position>(entity, 0.0f, 0.0f);
    registry.emplace<test::Velocity>(entity, 0.0f, 0.0f);

    CHECK((registry.hasAll<test::Position, test::Velocity>(entity)));
    CHECK(!(registry.hasAll<test::Position, test::Health>(entity)));
    CHECK((registry.hasAny<test::Position, test::Health>(entity)));
    CHECK(!(registry.hasAny<test::Health>(entity)));
}

TEST_CASE("clear_registry") {
    esengine::ecs::Registry registry;

    for (int i = 0; i < 10; ++i) {
        esengine::Entity e = registry.create();
        registry.emplace<test::Position>(e, static_cast<float>(i), 0.0f);
    }

    CHECK_EQ(registry.entityCount(), 10u);

    registry.clear();

    CHECK_EQ(registry.entityCount(), 0u);

    esengine::Entity e = registry.create();
    CHECK(registry.valid(e));
}

TEST_CASE("sparse_set_basic") {
    esengine::ecs::SparseSet<test::Position> set;

    esengine::Entity e1 = 0;
    esengine::Entity e2 = 5;
    esengine::Entity e3 = 100;

    set.emplace(e1, 1.0f, 1.0f);
    set.emplace(e2, 2.0f, 2.0f);
    set.emplace(e3, 3.0f, 3.0f);

    CHECK(set.contains(e1));
    CHECK(set.contains(e2));
    CHECK(set.contains(e3));
    CHECK(!set.contains(50));

    CHECK_EQ(set.get(e1).x, 1.0f);
    CHECK_EQ(set.get(e2).x, 2.0f);
    CHECK_EQ(set.get(e3).x, 3.0f);

    CHECK_EQ(set.size(), 3u);
}

TEST_CASE("sparse_set_remove") {
    esengine::ecs::SparseSet<test::Position> set;

    esengine::Entity e1 = 0;
    esengine::Entity e2 = 1;
    esengine::Entity e3 = 2;

    set.emplace(e1, 1.0f, 1.0f);
    set.emplace(e2, 2.0f, 2.0f);
    set.emplace(e3, 3.0f, 3.0f);

    set.remove(e2);

    CHECK(set.contains(e1));
    CHECK(!set.contains(e2));
    CHECK(set.contains(e3));

    CHECK_EQ(set.get(e1).x, 1.0f);
    CHECK_EQ(set.get(e3).x, 3.0f);

    CHECK_EQ(set.size(), 2u);
}

TEST_CASE("local_transform_default") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& local = registry.emplace<esengine::ecs::Transform>(entity);

    CHECK_EQ(local.position.x, 0.0f);
    CHECK_EQ(local.position.y, 0.0f);
    CHECK_EQ(local.position.z, 0.0f);
    CHECK_EQ(local.rotation.w, 1.0f);
    CHECK_EQ(local.scale.x, 1.0f);
}

TEST_CASE("local_transform_with_position") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& local = registry.emplace<esengine::ecs::Transform>(
        entity, glm::vec3(10.0f, 20.0f, 30.0f));

    CHECK_EQ(local.position.x, 10.0f);
    CHECK_EQ(local.position.y, 20.0f);
    CHECK_EQ(local.position.z, 30.0f);
}

TEST_CASE("local_transform_with_rotation") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    glm::quat rotation = glm::angleAxis(glm::radians(90.0f), glm::vec3(0, 1, 0));
    auto& local = registry.emplace<esengine::ecs::Transform>(
        entity, glm::vec3(0.0f), rotation);

    CHECK(esengine::math::approxEqual(local.rotation.y, rotation.y, 0.001f));
}

TEST_CASE("hierarchy_parent_child") {
    esengine::ecs::Registry registry;

    esengine::Entity parent = registry.create();
    esengine::Entity child = registry.create();

    registry.emplace<esengine::ecs::Transform>(parent, glm::vec3(10.0f, 0.0f, 0.0f));
    registry.emplace<esengine::ecs::Transform>(child, glm::vec3(5.0f, 0.0f, 0.0f));

    esengine::ecs::setParent(registry, child, parent);

    CHECK(registry.has<esengine::ecs::Parent>(child));
    CHECK(registry.has<esengine::ecs::Children>(parent));

    CHECK_EQ(registry.get<esengine::ecs::Parent>(child).entity, parent);
    CHECK_EQ(registry.get<esengine::ecs::Children>(parent).entities.size(), 1u);
    CHECK_EQ(registry.get<esengine::ecs::Children>(parent).entities[0], child);
}

TEST_CASE("hierarchy_depth") {
    esengine::ecs::Registry registry;

    esengine::Entity grandparent = registry.create();
    esengine::Entity parent = registry.create();
    esengine::Entity child = registry.create();

    registry.emplace<esengine::ecs::Transform>(grandparent);
    registry.emplace<esengine::ecs::Transform>(parent);
    registry.emplace<esengine::ecs::Transform>(child);

    esengine::ecs::setParent(registry, parent, grandparent);
    esengine::ecs::setParent(registry, child, parent);

    CHECK_EQ(registry.get<esengine::ecs::HierarchyDepth>(parent).depth, 1u);
    CHECK_EQ(registry.get<esengine::ecs::HierarchyDepth>(child).depth, 2u);
}

TEST_CASE("hierarchy_get_root") {
    esengine::ecs::Registry registry;

    esengine::Entity root = registry.create();
    esengine::Entity middle = registry.create();
    esengine::Entity leaf = registry.create();

    registry.emplace<esengine::ecs::Transform>(root);
    registry.emplace<esengine::ecs::Transform>(middle);
    registry.emplace<esengine::ecs::Transform>(leaf);

    esengine::ecs::setParent(registry, middle, root);
    esengine::ecs::setParent(registry, leaf, middle);

    CHECK_EQ(esengine::ecs::getRoot(registry, leaf), root);
    CHECK_EQ(esengine::ecs::getRoot(registry, middle), root);
    CHECK_EQ(esengine::ecs::getRoot(registry, root), root);
}

TEST_CASE("hierarchy_is_descendant") {
    esengine::ecs::Registry registry;

    esengine::Entity root = registry.create();
    esengine::Entity child = registry.create();
    esengine::Entity grandchild = registry.create();
    esengine::Entity unrelated = registry.create();

    registry.emplace<esengine::ecs::Transform>(root);
    registry.emplace<esengine::ecs::Transform>(child);
    registry.emplace<esengine::ecs::Transform>(grandchild);
    registry.emplace<esengine::ecs::Transform>(unrelated);

    esengine::ecs::setParent(registry, child, root);
    esengine::ecs::setParent(registry, grandchild, child);

    CHECK(esengine::ecs::isDescendantOf(registry, child, root));
    CHECK(esengine::ecs::isDescendantOf(registry, grandchild, root));
    CHECK(esengine::ecs::isDescendantOf(registry, grandchild, child));
    CHECK(!esengine::ecs::isDescendantOf(registry, root, child));
    CHECK(!esengine::ecs::isDescendantOf(registry, unrelated, root));
}

TEST_CASE("sprite_with_texture_handle") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    esengine::resource::TextureHandle texHandle(42);
    auto& sprite = registry.emplace<esengine::ecs::Sprite>(entity, texHandle);

    CHECK(sprite.texture.isValid());
    CHECK_EQ(sprite.texture.id(), 42u);
    CHECK_EQ(sprite.color.r, 1.0f);
}

TEST_CASE("camera_default") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& camera = registry.emplace<esengine::ecs::Camera>(entity);

    CHECK_EQ(camera.projectionType, esengine::ecs::ProjectionType::Perspective);
    CHECK_EQ(camera.fov, 60.0f);
    CHECK_EQ(camera.nearPlane, 0.1f);
    CHECK(!camera.isActive);
}

TEST_CASE("uuid_component") {
    esengine::ecs::Registry registry;
    esengine::Entity entity = registry.create();

    auto& uuid = registry.emplace<esengine::ecs::UUID>(entity, 0x12345678ABCDEF00ULL);

    CHECK_EQ(uuid.value, 0x12345678ABCDEF00ULL);

    esengine::ecs::UUID other(0x12345678ABCDEF00ULL);
    CHECK(uuid == other);
}
