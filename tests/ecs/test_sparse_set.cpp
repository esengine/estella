#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/ESEngine.hpp>
#include <algorithm>
#include <vector>

namespace test {

struct Position {
    float x = 0.0f;
    float y = 0.0f;
    Position() = default;
    Position(float x_, float y_) : x(x_), y(y_) {}
};

struct Heavy {
    int data[64] = {};
    int id = 0;
    Heavy() = default;
    explicit Heavy(int id_) : id(id_) {}
};

}  // namespace test

TEST_CASE("sparse_set_empty_state") {
    esengine::ecs::SparseSet<test::Position> set;

    CHECK(set.empty());
    CHECK_EQ(set.size(), 0u);
    CHECK_EQ(set.begin(), set.end());
    CHECK(!set.contains(esengine::Entity::make(0, 1)));
    CHECK(!set.contains(esengine::Entity::make(100, 1)));
    CHECK(set.tryGet(esengine::Entity::make(0, 1)) == nullptr);
}

TEST_CASE("sparse_set_emplace_and_get") {
    esengine::ecs::SparseSet<test::Position> set;

    auto& p = set.emplace(esengine::Entity::make(5, 1), 10.0f, 20.0f);

    CHECK_EQ(p.x, 10.0f);
    CHECK_EQ(p.y, 20.0f);
    CHECK(set.contains(esengine::Entity::make(5, 1)));
    CHECK_EQ(set.size(), 1u);

    auto& retrieved = set.get(esengine::Entity::make(5, 1));
    CHECK_EQ(retrieved.x, 10.0f);
    CHECK_EQ(retrieved.y, 20.0f);
}

TEST_CASE("sparse_set_try_get") {
    esengine::ecs::SparseSet<test::Position> set;
    set.emplace(esengine::Entity::make(3, 1), 1.0f, 2.0f);

    auto* found = set.tryGet(esengine::Entity::make(3, 1));
    CHECK(found != nullptr);
    CHECK_EQ(found->x, 1.0f);

    auto* notFound = set.tryGet(esengine::Entity::make(99, 1));
    CHECK(notFound == nullptr);
}

TEST_CASE("sparse_set_swap_and_pop_correctness") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(0, 1), 1.0f, 1.0f);
    set.emplace(esengine::Entity::make(1, 1), 2.0f, 2.0f);
    set.emplace(esengine::Entity::make(2, 1), 3.0f, 3.0f);
    set.emplace(esengine::Entity::make(3, 1), 4.0f, 4.0f);

    set.remove(esengine::Entity::make(1, 1));

    CHECK(!set.contains(esengine::Entity::make(1, 1)));
    CHECK_EQ(set.size(), 3u);

    CHECK_EQ(set.get(esengine::Entity::make(0, 1)).x, 1.0f);
    CHECK_EQ(set.get(esengine::Entity::make(2, 1)).x, 3.0f);
    CHECK_EQ(set.get(esengine::Entity::make(3, 1)).x, 4.0f);

    set.remove(esengine::Entity::make(0, 1));

    CHECK_EQ(set.size(), 2u);
    CHECK_EQ(set.get(esengine::Entity::make(2, 1)).x, 3.0f);
    CHECK_EQ(set.get(esengine::Entity::make(3, 1)).x, 4.0f);
}

TEST_CASE("sparse_set_remove_last_element") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(10, 1), 1.0f, 1.0f);
    set.emplace(esengine::Entity::make(20, 1), 2.0f, 2.0f);

    set.remove(esengine::Entity::make(20, 1));

    CHECK_EQ(set.size(), 1u);
    CHECK(set.contains(esengine::Entity::make(10, 1)));
    CHECK(!set.contains(esengine::Entity::make(20, 1)));
    CHECK_EQ(set.get(esengine::Entity::make(10, 1)).x, 1.0f);
}

TEST_CASE("sparse_set_remove_only_element") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(42, 1), 5.0f, 5.0f);
    set.remove(esengine::Entity::make(42, 1));

    CHECK(set.empty());
    CHECK(!set.contains(esengine::Entity::make(42, 1)));
}

TEST_CASE("sparse_set_page_boundary") {
    esengine::ecs::SparseSet<test::Position> set;

    constexpr esengine::u32 PAGE_SIZE = esengine::ecs::SparseSet<test::Position>::SPARSE_PAGE_SIZE;

    set.emplace(esengine::Entity::make(0, 1), 1.0f, 1.0f);
    set.emplace(esengine::Entity::make(PAGE_SIZE - 1, 1), 2.0f, 2.0f);
    set.emplace(esengine::Entity::make(PAGE_SIZE, 1), 3.0f, 3.0f);
    set.emplace(esengine::Entity::make(PAGE_SIZE + 1, 1), 4.0f, 4.0f);

    CHECK_EQ(set.size(), 4u);
    CHECK_EQ(set.get(esengine::Entity::make(0, 1)).x, 1.0f);
    CHECK_EQ(set.get(esengine::Entity::make(PAGE_SIZE - 1, 1)).x, 2.0f);
    CHECK_EQ(set.get(esengine::Entity::make(PAGE_SIZE, 1)).x, 3.0f);
    CHECK_EQ(set.get(esengine::Entity::make(PAGE_SIZE + 1, 1)).x, 4.0f);
}

TEST_CASE("sparse_set_large_entity_id") {
    esengine::ecs::SparseSet<test::Position> set;

    const esengine::Entity LARGE_ID = esengine::Entity::make(100000, 1);

    set.emplace(LARGE_ID, 99.0f, 99.0f);

    CHECK(set.contains(LARGE_ID));
    CHECK_EQ(set.get(LARGE_ID).x, 99.0f);
    CHECK_EQ(set.size(), 1u);
}

TEST_CASE("sparse_set_interleaved_insert_remove") {
    esengine::ecs::SparseSet<test::Position> set;

    for (esengine::u32 i = 0; i < 100; ++i) {
        esengine::Entity e = esengine::Entity::make(i, 1);
        set.emplace(e, static_cast<float>(i), 0.0f);
    }
    CHECK_EQ(set.size(), 100u);

    for (esengine::u32 i = 0; i < 100; i += 2) {
        set.remove(esengine::Entity::make(i, 1));
    }
    CHECK_EQ(set.size(), 50u);

    for (esengine::u32 i = 0; i < 100; ++i) {
        esengine::Entity e = esengine::Entity::make(i, 1);
        if (i % 2 == 0) {
            CHECK(!set.contains(e));
        } else {
            CHECK(set.contains(e));
            CHECK_EQ(set.get(e).x, static_cast<float>(i));
        }
    }
}

TEST_CASE("sparse_set_clear") {
    esengine::ecs::SparseSet<test::Position> set;

    for (esengine::u32 i = 0; i < 50; ++i) {
        set.emplace(esengine::Entity::make(i, 1), 0.0f, 0.0f);
    }
    CHECK_EQ(set.size(), 50u);

    set.clear();

    CHECK(set.empty());
    CHECK_EQ(set.size(), 0u);
    for (esengine::u32 i = 0; i < 50; ++i) {
        CHECK(!set.contains(esengine::Entity::make(i, 1)));
    }
}

TEST_CASE("sparse_set_reuse_after_clear") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(5, 1), 1.0f, 1.0f);
    set.clear();
    set.emplace(esengine::Entity::make(5, 1), 2.0f, 2.0f);

    CHECK(set.contains(esengine::Entity::make(5, 1)));
    CHECK_EQ(set.get(esengine::Entity::make(5, 1)).x, 2.0f);
    CHECK_EQ(set.size(), 1u);
}

TEST_CASE("sparse_set_iteration_order") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(10, 1), 10.0f, 0.0f);
    set.emplace(esengine::Entity::make(5, 1), 5.0f, 0.0f);
    set.emplace(esengine::Entity::make(20, 1), 20.0f, 0.0f);

    std::vector<esengine::Entity> iterated;
    for (auto entity : set) {
        iterated.push_back(entity);
    }

    CHECK_EQ(iterated.size(), 3u);

    CHECK(std::find(iterated.begin(), iterated.end(), esengine::Entity::make(5, 1)) != iterated.end());
    CHECK(std::find(iterated.begin(), iterated.end(), esengine::Entity::make(10, 1)) != iterated.end());
    CHECK(std::find(iterated.begin(), iterated.end(), esengine::Entity::make(20, 1)) != iterated.end());
}

TEST_CASE("sparse_set_components_dense_array") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(0, 1), 1.0f, 1.0f);
    set.emplace(esengine::Entity::make(5, 1), 2.0f, 2.0f);
    set.emplace(esengine::Entity::make(10, 1), 3.0f, 3.0f);

    auto& components = set.components();
    CHECK_EQ(components.size(), 3u);

    float sum = 0.0f;
    for (const auto& c : components) {
        sum += c.x;
    }
    CHECK_EQ(sum, 6.0f);
}

TEST_CASE("sparse_set_index_of") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(100, 1), 1.0f, 0.0f);
    set.emplace(esengine::Entity::make(200, 1), 2.0f, 0.0f);
    set.emplace(esengine::Entity::make(300, 1), 3.0f, 0.0f);

    auto idx100 = set.indexOf(esengine::Entity::make(100, 1));
    auto idx200 = set.indexOf(esengine::Entity::make(200, 1));
    auto idx300 = set.indexOf(esengine::Entity::make(300, 1));

    CHECK_NE(idx100, idx200);
    CHECK_NE(idx200, idx300);

    CHECK_EQ(set.components()[idx100].x, 1.0f);
    CHECK_EQ(set.components()[idx200].x, 2.0f);
    CHECK_EQ(set.components()[idx300].x, 3.0f);
}

TEST_CASE("sparse_set_modify_via_reference") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(7, 1), 1.0f, 1.0f);

    set.get(esengine::Entity::make(7, 1)).x = 999.0f;

    CHECK_EQ(set.get(esengine::Entity::make(7, 1)).x, 999.0f);
}

TEST_CASE("sparse_set_heavy_component") {
    esengine::ecs::SparseSet<test::Heavy> set;

    for (int i = 0; i < 100; ++i) {
        set.emplace(esengine::Entity::make(static_cast<esengine::u32>(i), 1), i);
    }

    for (int i = 0; i < 100; ++i) {
        CHECK_EQ(set.get(esengine::Entity::make(static_cast<esengine::u32>(i), 1)).id, i);
    }

    for (int i = 0; i < 50; ++i) {
        set.remove(esengine::Entity::make(static_cast<esengine::u32>(i * 2), 1));
    }

    for (int i = 0; i < 100; ++i) {
        esengine::Entity e = esengine::Entity::make(static_cast<esengine::u32>(i), 1);
        if (i % 2 == 0) {
            CHECK(!set.contains(e));
        } else {
            CHECK_EQ(set.get(e).id, i);
        }
    }
}

TEST_CASE("sparse_set_rebuild_sparse") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(esengine::Entity::make(0, 1), 1.0f, 0.0f);
    set.emplace(esengine::Entity::make(10, 1), 2.0f, 0.0f);
    set.emplace(esengine::Entity::make(20, 1), 3.0f, 0.0f);

    set.rebuildSparse();

    CHECK(set.contains(esengine::Entity::make(0, 1)));
    CHECK(set.contains(esengine::Entity::make(10, 1)));
    CHECK(set.contains(esengine::Entity::make(20, 1)));
    CHECK_EQ(set.get(esengine::Entity::make(0, 1)).x, 1.0f);
    CHECK_EQ(set.get(esengine::Entity::make(10, 1)).x, 2.0f);
    CHECK_EQ(set.get(esengine::Entity::make(20, 1)).x, 3.0f);
}
