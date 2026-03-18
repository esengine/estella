#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/ESEngine.hpp>
#include <string>
#include <memory>

namespace test {

struct DummyResource {
    int value = 0;
    explicit DummyResource(int v = 0) : value(v) {}
};

using DummyHandle = esengine::resource::Handle<DummyResource>;
using DummyPool = esengine::resource::ResourcePool<DummyResource>;

constexpr esengine::usize SENTINEL_SIZE = 1;

}  // namespace test

TEST_CASE("handle_invalid_by_default") {
    test::DummyHandle handle;

    CHECK(!handle.isValid());
    CHECK_EQ(handle.id(), test::DummyHandle::INVALID);
    CHECK(!static_cast<bool>(handle));
}

TEST_CASE("handle_from_parts") {
    auto handle = test::DummyHandle::fromParts(42, 3);

    CHECK(handle.isValid());
    CHECK_EQ(handle.index(), 42u);
    CHECK_EQ(handle.generation(), 3u);
}

TEST_CASE("handle_equality") {
    auto h1 = test::DummyHandle::fromParts(1, 0);
    auto h2 = test::DummyHandle::fromParts(1, 0);
    auto h3 = test::DummyHandle::fromParts(2, 0);
    auto h4 = test::DummyHandle::fromParts(1, 1);

    CHECK(h1 == h2);
    CHECK(h1 != h3);
    CHECK(h1 != h4);
}

TEST_CASE("handle_extract_static") {
    auto handle = test::DummyHandle::fromParts(123, 7);
    auto id = handle.id();

    CHECK_EQ(test::DummyHandle::extractIndex(id), 123u);
    CHECK_EQ(test::DummyHandle::extractGeneration(id), 7u);
}

TEST_CASE("pool_add_and_get") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(42));

    CHECK(handle.isValid());
    CHECK_EQ(pool.size(), 1u + test::SENTINEL_SIZE);

    auto* resource = pool.get(handle);
    CHECK(resource != nullptr);
    CHECK_EQ(resource->value, 42);
}

TEST_CASE("pool_add_multiple") {
    test::DummyPool pool;

    auto h1 = pool.add(esengine::makeUnique<test::DummyResource>(1));
    auto h2 = pool.add(esengine::makeUnique<test::DummyResource>(2));
    auto h3 = pool.add(esengine::makeUnique<test::DummyResource>(3));

    CHECK_EQ(pool.size(), 3u + test::SENTINEL_SIZE);
    CHECK(h1 != h2);
    CHECK(h2 != h3);

    CHECK_EQ(pool.get(h1)->value, 1);
    CHECK_EQ(pool.get(h2)->value, 2);
    CHECK_EQ(pool.get(h3)->value, 3);
}

TEST_CASE("pool_initial_ref_count") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(10));

    CHECK_EQ(pool.getRefCount(handle), 1u);
}

TEST_CASE("pool_add_ref") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(10));
    pool.addRef(handle);

    CHECK_EQ(pool.getRefCount(handle), 2u);

    pool.addRef(handle);
    CHECK_EQ(pool.getRefCount(handle), 3u);
}

TEST_CASE("pool_release_decrements_ref_count") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(10));
    pool.addRef(handle);
    CHECK_EQ(pool.getRefCount(handle), 2u);

    pool.release(handle.id());
    CHECK_EQ(pool.getRefCount(handle), 1u);

    auto* resource = pool.get(handle);
    CHECK(resource != nullptr);
    CHECK_EQ(resource->value, 10);
}

TEST_CASE("pool_release_frees_at_zero") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(10));
    CHECK_EQ(pool.size(), 1u + test::SENTINEL_SIZE);

    pool.release(handle.id());

    CHECK_EQ(pool.size(), 0u + test::SENTINEL_SIZE);
    CHECK(pool.get(handle) == nullptr);
}

TEST_CASE("pool_slot_reuse_with_generation") {
    test::DummyPool pool;

    auto h1 = pool.add(esengine::makeUnique<test::DummyResource>(1));
    auto h1Index = h1.index();
    pool.release(h1.id());

    auto h2 = pool.add(esengine::makeUnique<test::DummyResource>(2));

    CHECK_EQ(h2.index(), h1Index);
    CHECK_NE(h1.generation(), h2.generation());

    CHECK(pool.get(h1) == nullptr);
    CHECK_EQ(pool.get(h2)->value, 2);
}

TEST_CASE("pool_stale_handle_returns_null") {
    test::DummyPool pool;

    auto h1 = pool.add(esengine::makeUnique<test::DummyResource>(1));
    pool.release(h1.id());

    auto h2 = pool.add(esengine::makeUnique<test::DummyResource>(2));
    (void)h2;

    CHECK(pool.get(h1) == nullptr);
}

TEST_CASE("pool_path_based_lookup") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(42), "textures/player.png");

    auto found = pool.findByPath("textures/player.png");
    CHECK(found.isValid());
    CHECK_EQ(found.id(), handle.id());

    auto notFound = pool.findByPath("textures/enemy.png");
    CHECK(!notFound.isValid());
}

TEST_CASE("pool_set_path") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(42));

    pool.setPath(handle, "shaders/default.glsl");

    auto found = pool.findByPath("shaders/default.glsl");
    CHECK(found.isValid());
    CHECK_EQ(found.id(), handle.id());

    CHECK_EQ(pool.getPath(handle), "shaders/default.glsl");
}

TEST_CASE("pool_path_cleared_on_release") {
    test::DummyPool pool;

    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(1), "asset.png");
    pool.release(handle.id());

    auto found = pool.findByPath("asset.png");
    CHECK(!found.isValid());
}

TEST_CASE("pool_clear") {
    test::DummyPool pool;

    auto h1 = pool.add(esengine::makeUnique<test::DummyResource>(1), "a.png");
    auto h2 = pool.add(esengine::makeUnique<test::DummyResource>(2), "b.png");

    pool.clear();

    CHECK_EQ(pool.size(), 0u);
    CHECK(pool.get(h1) == nullptr);
    CHECK(pool.get(h2) == nullptr);
    CHECK(!pool.findByPath("a.png").isValid());
}

TEST_CASE("pool_const_get") {
    test::DummyPool pool;
    auto handle = pool.add(esengine::makeUnique<test::DummyResource>(55));

    const auto& constPool = pool;
    const auto* resource = constPool.get(handle);
    CHECK(resource != nullptr);
    CHECK_EQ(resource->value, 55);
}

TEST_CASE("pool_multiple_release_cycles") {
    test::DummyPool pool;

    for (int cycle = 0; cycle < 10; ++cycle) {
        auto handle = pool.add(esengine::makeUnique<test::DummyResource>(cycle));
        CHECK_EQ(pool.get(handle)->value, cycle);
        pool.release(handle.id());
        CHECK_EQ(pool.size(), 0u + test::SENTINEL_SIZE);
    }
}

TEST_CASE("pool_mixed_operations") {
    test::DummyPool pool;

    auto h1 = pool.add(esengine::makeUnique<test::DummyResource>(1));
    auto h2 = pool.add(esengine::makeUnique<test::DummyResource>(2));
    auto h3 = pool.add(esengine::makeUnique<test::DummyResource>(3));
    CHECK_EQ(pool.size(), 3u + test::SENTINEL_SIZE);

    pool.release(h2.id());
    CHECK_EQ(pool.size(), 2u + test::SENTINEL_SIZE);

    auto h4 = pool.add(esengine::makeUnique<test::DummyResource>(4));
    CHECK_EQ(pool.size(), 3u + test::SENTINEL_SIZE);

    CHECK_EQ(pool.get(h1)->value, 1);
    CHECK(pool.get(h2) == nullptr);
    CHECK_EQ(pool.get(h3)->value, 3);
    CHECK_EQ(pool.get(h4)->value, 4);

    pool.addRef(h1);
    pool.release(h1.id());
    CHECK_EQ(pool.getRefCount(h1), 1u);
    CHECK_EQ(pool.get(h1)->value, 1);

    pool.release(h1.id());
    CHECK(pool.get(h1) == nullptr);
}
