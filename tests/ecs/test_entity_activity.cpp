// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest.h>
#include <array>
#include <limits>
#include "esengine/ecs/TransformSystem.hpp"

using namespace esengine;
using namespace esengine::ecs;
struct Sample { int value = 1; };

TEST_CASE("activity is derived without overwriting a child's switch") {
    Registry r;
    const auto root = r.create(), child = r.create(), leaf = r.create();
    setParent(r, child, root); setParent(r, leaf, child);
    r.setEntityEnabled(root, false);
    CHECK_FALSE(r.isEntityActive(leaf));
    r.setEntityEnabled(child, false);
    r.setEntityEnabled(root, true);
    CHECK(r.isEntityActive(root));
    CHECK_FALSE(r.isEntityActive(leaf));
    r.setEntityEnabled(child, true);
    CHECK(r.isEntityActive(leaf));
}
TEST_CASE("reparenting and detachment invalidate the derived closure") {
    Registry r;
    const auto off = r.create(), on = r.create(), child = r.create();
    r.setEntityEnabled(off, false); setParent(r, child, off);
    CHECK_FALSE(r.isEntityActive(child));
    setParent(r, child, on); CHECK(r.isEntityActive(child));
    setParent(r, child, off); CHECK_FALSE(r.isEntityActive(child));
    setParent(r, child, INVALID_ENTITY); CHECK(r.isEntityActive(child));
}
TEST_CASE("active views filter single, multiple, snapshot and live iteration") {
    Registry r;
    const auto on = r.create(), off = r.create();
    for (auto e : {on, off}) { r.emplace<Sample>(e); r.emplace<Transform>(e); }
    r.setEntityEnabled(off, false);
    CHECK(r.view<Sample>().size() == 2);
    int count = 0;
    for (auto e : r.activeView<Sample>()) { CHECK(e == on); ++count; }
    CHECK(count == 1);
    count = 0;
    r.activeView<Sample, Transform>().each([&](Entity e, Sample&, Transform&) { CHECK(e == on); ++count; });
    CHECK(count == 1);
    count = 0;
    r.activeView<Sample>().eachLive([&](Sample&) { ++count; });
    CHECK(count == 1);
    count = 0;
    r.activeView<Sample>().each([&](Sample&) { ++count; });
    r.activeView<Sample>().each([&](Entity e) { CHECK(e == on); ++count; });
    r.activeView<Sample>().eachLive([&](Entity e, Sample&) { CHECK(e == on); ++count; });
    r.activeView<Sample>().eachLive([&](Entity e) { CHECK(e == on); ++count; });
    CHECK(count == 4);
}
TEST_CASE("destruction and clear do not disable a recycled slot") {
    Registry r;
    const auto old = r.create();
    r.setEntityEnabled(old, false); r.destroy(old);
    const auto replacement = r.create();
    CHECK(replacement.index() == old.index());
    CHECK(r.isEntityActive(replacement));
    CHECK_FALSE(r.isEntityActive(old));
    CHECK_FALSE(r.setEntityEnabled(old, false));
    r.setEntityEnabled(replacement, false); r.clear();
    CHECK(r.isEntityActive(r.create()));
}
TEST_CASE("a deep chain resolves iteratively and responds to edits of the relation itself") {
    Registry r;
    const auto root = r.create();
    auto last = root;
    for (int i = 0; i < 50000; ++i) { const auto child = r.create(); r.childOf().link(child, last); last = child; }
    r.setEntityEnabled(root, false);
    CHECK_FALSE(r.isEntityActive(last));
    r.childOf().unlink(last); CHECK(r.isEntityActive(last));
    r.childOf().link(last, root); CHECK_FALSE(r.isEntityActive(last));
}
TEST_CASE("unrelated entity churn leaves the all-active epoch stable") {
    Registry r;
    const auto epoch = r.activityEpoch();
    const auto e = r.create(); r.destroy(e);
    CHECK(r.activityEpoch() == epoch);
}

struct JournalPosition {
    float x = 0, y = 0;
    JournalPosition() = default;
    JournalPosition(float a, float b) : x(a), y(b) {}
};

TEST_CASE("entity change history is bounded and owned by independent readers") {
    using namespace esengine::ecs;
    EntityChangeJournal journal;
    journal.record(1);
    CHECK(journal.retainedRows() == 0);
    journal.record(1, ENTITY_CHANGE_RESET);
    CHECK(journal.resetEpoch() == 1);
    std::array<EntityChangeRow, ENTITY_CHANGE_CAPACITY> rows{};
    CHECK(journal.read(0, rows) == -1);
    const auto first = journal.watch();
    CHECK(journal.resetEpoch() == 1);
    journal.record(10);
    const auto second = journal.watch();
    const auto cursor = journal.sequence();
    journal.record(20, ENTITY_CHANGE_REPLACED);
    REQUIRE(journal.read(0, rows) == 2);
    CHECK(rows[0].entity == 10);
    CHECK(rows[1].flags == ENTITY_CHANGE_REPLACED);
    REQUIRE(journal.read(cursor, rows) == 1);
    CHECK(rows[0].entity == 20);
    journal.unwatch(first);
    CHECK(journal.readerCount() == 1);
    CHECK(journal.read(0, rows) == 2);
    journal.unwatch(first);
    CHECK(journal.readerCount() == 1);
    journal.unwatch(second);
    CHECK(journal.readerCount() == 0);
    CHECK(journal.retainedRows() == 0);
    CHECK(journal.read(cursor, rows) == -1);
}

TEST_CASE("entity change overflow and invalid cursors refuse partial histories") {
    using namespace esengine::ecs;
    EntityChangeJournal journal;
    journal.watch();
    std::array<EntityChangeRow, ENTITY_CHANGE_CAPACITY> rows{};
    for (esengine::u32 i = 1; i <= ENTITY_CHANGE_CAPACITY + 1; ++i) journal.record(i);
    rows[0].entity = 99;
    CHECK(journal.read(0, rows) == -1);
    CHECK(rows[0].entity == 99);
    CHECK(journal.read(1, std::span(rows).first(1)) == -1);
    CHECK(rows[0].entity == 99);
    REQUIRE(journal.read(1, rows) == ENTITY_CHANGE_CAPACITY);
    CHECK(rows.front().entity == 2);
    CHECK(rows.back().entity == ENTITY_CHANGE_CAPACITY + 1);
    CHECK(journal.read(-1, rows) == -1);
    CHECK(journal.read(1.5, rows) == -1);
    CHECK(journal.read(journal.sequence() + 1, rows) == -1);
    CHECK(journal.read(std::numeric_limits<double>::quiet_NaN(), rows) == -1);
    CHECK(journal.read(std::numeric_limits<double>::infinity(), rows) == -1);
    CHECK(journal.read(journal.sequence(), {}) == 0);
}

TEST_CASE("component revisions survive without retaining native mutation rows") {
    EntityChangeJournal journal;
    journal.record(1, 0, 5);
    const auto initial = journal.componentRevision(5, false), membership = journal.componentRevision(5, true);
    CHECK(initial > 0); CHECK(membership > 0);
    journal.record(1, ENTITY_CHANGE_REPLACED, 5);
    CHECK(journal.componentRevision(5, false) > initial);
    CHECK(journal.componentRevision(5, true) == membership);
    CHECK(journal.componentRevision(6, false) == 0);
    CHECK(journal.retainedRows() == 0);
    const auto reader = journal.watch(); journal.unwatch(reader);
    CHECK(journal.componentRevision(5, false) > initial);
    CHECK(journal.retainedRows() == 0);
}

TEST_CASE("registry history covers component lifetime and explicit native writes") {
    using namespace esengine::ecs;
    Registry registry;
    const auto reader = registry.watchEntityChanges();
    const auto entity = registry.create();
    registry.emplace<JournalPosition>(entity, 1, 2);
    registry.emplaceOrReplace<JournalPosition>(entity, 3, 4);
    registry.getOrEmplace<Sample>(entity);
    const auto beforeBorrow = registry.entityChangeSequence();
    registry.getOrEmplace<JournalPosition>(entity);
    registry.get<JournalPosition>(entity).x = 5;
    CHECK(registry.entityChangeSequence() == beforeBorrow);
    registry.recordEntityChange(entity, ENTITY_CHANGE_REPLACED);
    registry.remove<JournalPosition>(entity);
    registry.destroy(entity);
    std::array<EntityChangeRow, 16> rows{};
    REQUIRE(registry.readEntityChanges(0, rows) == 7);
    for (int i = 0; i < 7; ++i) CHECK(rows[i].entity == entity.id());
    CHECK(rows[2].flags == ENTITY_CHANGE_REPLACED);
    CHECK(rows[4].flags == ENTITY_CHANGE_REPLACED);
    CHECK(rows[0].component == ENTITY_CHANGE_NO_COMPONENT);
    CHECK(rows[1].component == componentTypeId<JournalPosition>());
    CHECK(rows[2].component == componentTypeId<JournalPosition>());
    CHECK(rows[3].component == componentTypeId<Sample>());
    CHECK(rows[5].component == componentTypeId<JournalPosition>());
    const auto cursor = registry.entityChangeSequence();
    registry.invalidateActivityHierarchy();
    CHECK(registry.entityChangeResetEpoch() == 0);
    registry.clear();
    CHECK(registry.entityChangeResetEpoch() == 1);
    REQUIRE(registry.readEntityChanges(cursor, rows) == 2);
    CHECK(rows[0].flags == ENTITY_CHANGE_RESET);
    registry.unwatchEntityChanges(reader);
}

TEST_CASE("hierarchy changes identify the child subtree even with inactive unrelated entities") {
    using namespace esengine::ecs;
    Registry registry;
    const auto parent = registry.create(), child = registry.create(), inactive = registry.create();
    registry.setEntityEnabled(inactive, false);
    registry.watchEntityChanges();
    const auto added = registry.create();
    REQUIRE(setParent(registry, child, parent));
    registry.setEntityEnabled(parent, false);
    std::array<EntityChangeRow, 64> rows{};
    const auto count = registry.readEntityChanges(0, rows);
    REQUIRE(count > 0);
    bool childSubtree = false, parentSubtree = false, newEntity = false;
    for (int i = 0; i < count; ++i) {
        CHECK((rows[i].flags & ENTITY_CHANGE_RESET) == 0);
        if (rows[i].entity == child.id() && (rows[i].flags & ENTITY_CHANGE_SUBTREE)) childSubtree = true;
        if (rows[i].entity == parent.id() && (rows[i].flags & ENTITY_CHANGE_SUBTREE)) parentSubtree = true;
        if (rows[i].entity == added.id()) newEntity = true;
    }
    CHECK(childSubtree); CHECK(parentSubtree); CHECK(newEntity);
    const auto cursor = registry.entityChangeSequence();
    registry.destroy(parent);
    REQUIRE(registry.readEntityChanges(cursor, rows) > 0);
    CHECK(rows[1].entity == child.id());
    CHECK(rows[1].flags == ENTITY_CHANGE_SUBTREE);
}
