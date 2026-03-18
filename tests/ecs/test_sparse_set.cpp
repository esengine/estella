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
    CHECK(!set.contains(0));
    CHECK(!set.contains(100));
    CHECK(set.tryGet(0) == nullptr);
}

TEST_CASE("sparse_set_emplace_and_get") {
    esengine::ecs::SparseSet<test::Position> set;

    auto& p = set.emplace(5, 10.0f, 20.0f);

    CHECK_EQ(p.x, 10.0f);
    CHECK_EQ(p.y, 20.0f);
    CHECK(set.contains(5));
    CHECK_EQ(set.size(), 1u);

    auto& retrieved = set.get(5);
    CHECK_EQ(retrieved.x, 10.0f);
    CHECK_EQ(retrieved.y, 20.0f);
}

TEST_CASE("sparse_set_try_get") {
    esengine::ecs::SparseSet<test::Position> set;
    set.emplace(3, 1.0f, 2.0f);

    auto* found = set.tryGet(3);
    CHECK(found != nullptr);
    CHECK_EQ(found->x, 1.0f);

    auto* notFound = set.tryGet(99);
    CHECK(notFound == nullptr);
}

TEST_CASE("sparse_set_swap_and_pop_correctness") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(0, 1.0f, 1.0f);
    set.emplace(1, 2.0f, 2.0f);
    set.emplace(2, 3.0f, 3.0f);
    set.emplace(3, 4.0f, 4.0f);

    set.remove(1);

    CHECK(!set.contains(1));
    CHECK_EQ(set.size(), 3u);

    CHECK_EQ(set.get(0).x, 1.0f);
    CHECK_EQ(set.get(2).x, 3.0f);
    CHECK_EQ(set.get(3).x, 4.0f);

    set.remove(0);

    CHECK_EQ(set.size(), 2u);
    CHECK_EQ(set.get(2).x, 3.0f);
    CHECK_EQ(set.get(3).x, 4.0f);
}

TEST_CASE("sparse_set_remove_last_element") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(10, 1.0f, 1.0f);
    set.emplace(20, 2.0f, 2.0f);

    set.remove(20);

    CHECK_EQ(set.size(), 1u);
    CHECK(set.contains(10));
    CHECK(!set.contains(20));
    CHECK_EQ(set.get(10).x, 1.0f);
}

TEST_CASE("sparse_set_remove_only_element") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(42, 5.0f, 5.0f);
    set.remove(42);

    CHECK(set.empty());
    CHECK(!set.contains(42));
}

TEST_CASE("sparse_set_page_boundary") {
    esengine::ecs::SparseSet<test::Position> set;

    constexpr esengine::Entity PAGE_SIZE = esengine::ecs::SparseSet<test::Position>::SPARSE_PAGE_SIZE;

    set.emplace(0, 1.0f, 1.0f);
    set.emplace(PAGE_SIZE - 1, 2.0f, 2.0f);
    set.emplace(PAGE_SIZE, 3.0f, 3.0f);
    set.emplace(PAGE_SIZE + 1, 4.0f, 4.0f);

    CHECK_EQ(set.size(), 4u);
    CHECK_EQ(set.get(0).x, 1.0f);
    CHECK_EQ(set.get(PAGE_SIZE - 1).x, 2.0f);
    CHECK_EQ(set.get(PAGE_SIZE).x, 3.0f);
    CHECK_EQ(set.get(PAGE_SIZE + 1).x, 4.0f);
}

TEST_CASE("sparse_set_large_entity_id") {
    esengine::ecs::SparseSet<test::Position> set;

    constexpr esengine::Entity LARGE_ID = 100000;

    set.emplace(LARGE_ID, 99.0f, 99.0f);

    CHECK(set.contains(LARGE_ID));
    CHECK_EQ(set.get(LARGE_ID).x, 99.0f);
    CHECK_EQ(set.size(), 1u);
}

TEST_CASE("sparse_set_interleaved_insert_remove") {
    esengine::ecs::SparseSet<test::Position> set;

    for (esengine::Entity i = 0; i < 100; ++i) {
        set.emplace(i, static_cast<float>(i), 0.0f);
    }
    CHECK_EQ(set.size(), 100u);

    for (esengine::Entity i = 0; i < 100; i += 2) {
        set.remove(i);
    }
    CHECK_EQ(set.size(), 50u);

    for (esengine::Entity i = 0; i < 100; ++i) {
        if (i % 2 == 0) {
            CHECK(!set.contains(i));
        } else {
            CHECK(set.contains(i));
            CHECK_EQ(set.get(i).x, static_cast<float>(i));
        }
    }
}

TEST_CASE("sparse_set_clear") {
    esengine::ecs::SparseSet<test::Position> set;

    for (esengine::Entity i = 0; i < 50; ++i) {
        set.emplace(i, 0.0f, 0.0f);
    }
    CHECK_EQ(set.size(), 50u);

    set.clear();

    CHECK(set.empty());
    CHECK_EQ(set.size(), 0u);
    for (esengine::Entity i = 0; i < 50; ++i) {
        CHECK(!set.contains(i));
    }
}

TEST_CASE("sparse_set_reuse_after_clear") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(5, 1.0f, 1.0f);
    set.clear();
    set.emplace(5, 2.0f, 2.0f);

    CHECK(set.contains(5));
    CHECK_EQ(set.get(5).x, 2.0f);
    CHECK_EQ(set.size(), 1u);
}

TEST_CASE("sparse_set_iteration_order") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(10, 10.0f, 0.0f);
    set.emplace(5, 5.0f, 0.0f);
    set.emplace(20, 20.0f, 0.0f);

    std::vector<esengine::Entity> iterated;
    for (auto entity : set) {
        iterated.push_back(entity);
    }

    CHECK_EQ(iterated.size(), 3u);

    CHECK(std::find(iterated.begin(), iterated.end(), 5) != iterated.end());
    CHECK(std::find(iterated.begin(), iterated.end(), 10) != iterated.end());
    CHECK(std::find(iterated.begin(), iterated.end(), 20) != iterated.end());
}

TEST_CASE("sparse_set_components_dense_array") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(0, 1.0f, 1.0f);
    set.emplace(5, 2.0f, 2.0f);
    set.emplace(10, 3.0f, 3.0f);

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

    set.emplace(100, 1.0f, 0.0f);
    set.emplace(200, 2.0f, 0.0f);
    set.emplace(300, 3.0f, 0.0f);

    auto idx100 = set.indexOf(100);
    auto idx200 = set.indexOf(200);
    auto idx300 = set.indexOf(300);

    CHECK_NE(idx100, idx200);
    CHECK_NE(idx200, idx300);

    CHECK_EQ(set.components()[idx100].x, 1.0f);
    CHECK_EQ(set.components()[idx200].x, 2.0f);
    CHECK_EQ(set.components()[idx300].x, 3.0f);
}

TEST_CASE("sparse_set_modify_via_reference") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(7, 1.0f, 1.0f);

    set.get(7).x = 999.0f;

    CHECK_EQ(set.get(7).x, 999.0f);
}

TEST_CASE("sparse_set_heavy_component") {
    esengine::ecs::SparseSet<test::Heavy> set;

    for (int i = 0; i < 100; ++i) {
        set.emplace(static_cast<esengine::Entity>(i), i);
    }

    for (int i = 0; i < 100; ++i) {
        CHECK_EQ(set.get(static_cast<esengine::Entity>(i)).id, i);
    }

    for (int i = 0; i < 50; ++i) {
        set.remove(static_cast<esengine::Entity>(i * 2));
    }

    for (int i = 0; i < 100; ++i) {
        if (i % 2 == 0) {
            CHECK(!set.contains(static_cast<esengine::Entity>(i)));
        } else {
            CHECK_EQ(set.get(static_cast<esengine::Entity>(i)).id, i);
        }
    }
}

TEST_CASE("sparse_set_rebuild_sparse") {
    esengine::ecs::SparseSet<test::Position> set;

    set.emplace(0, 1.0f, 0.0f);
    set.emplace(10, 2.0f, 0.0f);
    set.emplace(20, 3.0f, 0.0f);

    set.rebuildSparse();

    CHECK(set.contains(0));
    CHECK(set.contains(10));
    CHECK(set.contains(20));
    CHECK_EQ(set.get(0).x, 1.0f);
    CHECK_EQ(set.get(10).x, 2.0f);
    CHECK_EQ(set.get(20).x, 3.0f);
}
