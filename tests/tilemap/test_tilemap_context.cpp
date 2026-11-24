#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>

#include <esengine/core/EstellaContext.hpp>
#include <esengine/tilemap/TilemapWorlds.hpp>
#include "../renderer/MockGfxDevice.hpp"

using namespace esengine;
using esengine::tilemap::TilemapWorlds;

TEST_CASE("headless contexts own independent tilemap data") {
    EstellaContext first;
    EstellaContext second;
    auto a = first.require<TilemapWorlds>().legacy();
    auto b = second.require<TilemapWorlds>().legacy();
    REQUIRE(a != nullptr);
    REQUIRE(b != nullptr);
    CHECK(a != b);
    const auto layer = Entity::make(10, 1);
    a->initInfiniteLayer(layer, 16, 16);
    b->initInfiniteLayer(layer, 16, 16);
    a->setTile(layer, -33, 64, 7);
    b->setTile(layer, -33, 64, 9);
    CHECK(a->getTile(layer, -33, 64) == 7);
    CHECK(b->getTile(layer, -33, 64) == 9);
    CHECK_FALSE(first.isInitialized());
    CHECK_FALSE(second.isInitialized());
}

TEST_CASE("renderer initialization retains tilemaps prepared headlessly") {
    EstellaContext context;
    auto tiles = context.require<TilemapWorlds>().legacy();
    REQUIRE(tiles != nullptr);
    const auto layer = Entity::make(10, 1);
    tiles->initLayer(layer, 8, 8, 16, 16);
    tiles->setTile(layer, 2, 3, 11);
    REQUIRE(context.init(makeUnique<MockGfxDevice>()));
    CHECK(context.require<TilemapWorlds>().legacy() == tiles);
    CHECK(context.require<TilemapWorlds>().legacy()->getTile(layer, 2, 3) == 11);
    context.shutdown();
    REQUIRE(context.init(makeUnique<MockGfxDevice>()));
    CHECK(context.tryGet<TilemapWorlds>() != nullptr);
    CHECK_FALSE(context.require<TilemapWorlds>().legacy()->hasLayer(layer));
}

TEST_CASE("the first registry adopts a headless layer and despawning its twin leaves it intact") {
    tilemap::TilemapWorlds worlds;
    ecs::Registry a;
    auto b = makeUnique<ecs::Registry>();
    const auto e = a.create();
    REQUIRE(b->create() == e);
    worlds.legacy()->initInfiniteLayer(e, 16, 16);
    worlds.legacy()->setTile(e, 0, 0, 7);
    CHECK(worlds.forRender(a)->getTile(e, 0, 0) == 7);
    CHECK_FALSE(worlds.forRender(*b));
    Weak<tilemap::TilemapSystem> retiring = worlds.select(*b);
    worlds.select(*b)->initInfiniteLayer(e, 16, 16);
    worlds.select(*b)->setTile(e, 0, 0, 9);
    b->destroy(e);
    CHECK_FALSE(worlds.select(*b)->hasLayer(e));
    b.reset();
    CHECK(retiring.expired());
    CHECK(worlds.select(a)->getTile(e, 0, 0) == 7);
}
