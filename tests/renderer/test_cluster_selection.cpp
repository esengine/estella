// The rule a clustered mesh is drawn by, held against its own claim without a device: from any eye, of the levels a
// surface has, exactly one is drawn everywhere. A pixel gate can show a hole or a doubled surface; only this can say
// that the rule itself made it.

#include "esengine/renderer/lod/ClusterSelection.hpp"

#include <cstdio>
#include <random>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

/** A node of a binary hierarchy over a strip of leaves: which leaves it stands for, and its bounds. */
struct Node {
    u32 firstLeaf = 0;
    u32 leafCount = 0;
    glm::vec3 centre{0.0f};
    f32 radius = 0.0f;
    f32 error = 0.0f;
    i32 parent = -1;
};

/**
 * Leaves in a row along x, paired level by level. A node's sphere holds its two children's and its error is larger: what
 * the bake guarantees and all the rule needs.
 */
std::vector<Node> buildNodes(u32 leaves) {
    std::vector<Node> nodes;
    std::vector<u32> level;
    for (u32 i = 0; i < leaves; ++i) {
        level.push_back(static_cast<u32>(nodes.size()));
        nodes.push_back({i, 1, glm::vec3(static_cast<f32>(i) * 2.0f + 1.0f, 0.0f, 0.0f), 1.0f, 0.0f, -1});
    }
    f32 error = 0.01f;
    while (level.size() > 1) {
        std::vector<u32> next;
        for (usize i = 0; i + 1 < level.size(); i += 2) {
            const Node a = nodes[level[i]], b = nodes[level[i + 1]];
            Node parent;
            parent.firstLeaf = a.firstLeaf;
            parent.leafCount = a.leafCount + b.leafCount;
            parent.centre = (a.centre + b.centre) * 0.5f;
            parent.radius = glm::distance(a.centre, b.centre) * 0.5f + std::max(a.radius, b.radius);
            parent.error = error;
            const i32 id = static_cast<i32>(nodes.size());
            nodes[level[i]].parent = id;
            nodes[level[i + 1]].parent = id;
            next.push_back(static_cast<u32>(id));
            nodes.push_back(parent);
        }
        level = next;
        error *= 2.5f;
    }
    return nodes;
}

lod::ClusterHierarchy hierarchyOf(const std::vector<Node>& nodes) {
    lod::ClusterHierarchy h;
    for (const Node& n : nodes) {
        lod::Cluster c;
        c.firstIndex = static_cast<u32>(h.indices.size());
        c.indexCount = 3;
        // One triangle a node, naming its own number: an assembled cut then reads back as the nodes picked.
        const u32 id = static_cast<u32>(h.clusters.size());
        h.indices.insert(h.indices.end(), {id, id, id});
        c.centre[0] = n.centre.x; c.centre[1] = n.centre.y; c.centre[2] = n.centre.z;
        c.radius = n.radius;
        c.error = n.error;
        if (n.parent >= 0) {
            const Node& p = nodes[static_cast<usize>(n.parent)];
            c.groupCentre[0] = p.centre.x; c.groupCentre[1] = p.centre.y; c.groupCentre[2] = p.centre.z;
            c.groupRadius = p.radius;
            c.groupError = p.error;
        } else {
            c.groupError = std::numeric_limits<f32>::infinity();
        }
        h.clusters.push_back(c);
    }
    return h;
}

/** Whether every leaf is stood for by exactly one picked node. */
bool coversOnce(const std::vector<Node>& nodes, const std::vector<u32>& picked, u32 leaves) {
    std::vector<u32> times(leaves, 0);
    for (const u32 id : picked) {
        for (u32 i = 0; i < nodes[id].leafCount; ++i) ++times[nodes[id].firstLeaf + i];
    }
    for (const u32 t : times) if (t != 1) return false;
    return true;
}

}  // namespace

static void testOneLevelEverywhere() {
    const u32 leaves = 64;
    const std::vector<Node> nodes = buildNodes(leaves);
    const lod::ClusterHierarchy h = hierarchyOf(nodes);
    CHECK(lod::clusterHierarchyValid(h, static_cast<u32>(nodes.size())), "the hierarchy is one a cut can be assembled from");

    std::mt19937 rng(7);
    std::uniform_real_distribution<f32> along(-200.0f, 330.0f), away(-300.0f, 300.0f), scale(0.5f, 4000.0f);
    std::vector<u32> picked;
    bool once = true;
    for (u32 i = 0; i < 4000 && once; ++i) {
        lod::ClusterEye eye;
        eye.position = glm::vec3(along(rng), away(rng), away(rng));
        eye.scale = scale(rng);
        lod::selectClusters(h, eye, picked);
        once = coversOnce(nodes, picked, leaves);
    }
    CHECK(once, "from 4000 eyes, perspective, every leaf is stood for exactly once");

    once = true;
    for (u32 i = 0; i < 400 && once; ++i) {
        lod::ClusterEye eye;
        eye.flat = true;
        eye.scale = scale(rng) * 0.05f;
        lod::selectClusters(h, eye, picked);
        once = coversOnce(nodes, picked, leaves);
    }
    CHECK(once, "under an orthographic view too, where distance says nothing");
}

static void testEnds() {
    const u32 leaves = 32;
    const std::vector<Node> nodes = buildNodes(leaves);
    const lod::ClusterHierarchy h = hierarchyOf(nodes);
    std::vector<u32> picked;

    lod::ClusterEye near;
    near.position = glm::vec3(31.0f, 0.5f, 0.0f);
    near.scale = 1.0e9f;
    CHECK(lod::selectClusters(h, near, picked) == leaves * 3 && picked.size() == leaves,
          "an eye on the surface that allows no error draws the leaves");

    lod::ClusterEye far;
    far.position = glm::vec3(0.0f, 1.0e6f, 0.0f);
    lod::selectClusters(h, far, picked);
    CHECK(picked.size() == 1 && picked[0] == nodes.size() - 1, "an eye far away draws the one cluster at the top");

    lod::ClusterEye beside;
    beside.position = glm::vec3(1.0f, 3.0f, 0.0f);
    beside.scale = 300.0f;
    lod::selectClusters(h, beside, picked);
    bool leaf = false, coarse = false;
    for (const u32 id : picked) (nodes[id].leafCount == 1 ? leaf : coarse) = true;
    CHECK(leaf && coarse && coversOnce(nodes, picked, leaves), "an eye at one end draws leaves near it and coarser clusters beyond");
}

static void testAssembly() {
    const std::vector<Node> nodes = buildNodes(8);
    const lod::ClusterHierarchy h = hierarchyOf(nodes);
    const std::vector<u32> picked{1, 4, 9};
    std::vector<u32> cut;
    lod::assembleCut(h, picked, 0, cut);
    CHECK(cut == (std::vector<u32>{1, 1, 1, 4, 4, 4, 9, 9, 9}), "a cut is the picked clusters' runs, one after another");
    lod::assembleCut(h, picked, 100, cut);
    CHECK(cut == (std::vector<u32>{101, 101, 101, 104, 104, 104, 109, 109, 109}), "counted from a page's first vertex when the mesh shares one");
    CHECK(lod::cutSignature(picked) == lod::cutSignature({1, 4, 9}) && lod::cutSignature(picked) != lod::cutSignature({1, 4, 8})
              && lod::cutSignature(picked) != lod::cutSignature({1, 4}),
          "the signature is the picked clusters' and changes when they do");

    lod::ClusterHierarchy broken = h;
    broken.clusters[2].indexCount = 1000;
    CHECK(!lod::clusterHierarchyValid(broken, 100), "a run past the indices is refused");
    CHECK(!lod::clusterHierarchyValid(h, 3), "an index that names no vertex is refused");
    broken = h;
    broken.clusters[0].groupError = -1.0f;
    CHECK(!lod::clusterHierarchyValid(broken, 100), "a group with less error than its cluster is refused");
}

int main() {
    testOneLevelEverywhere();
    testEnds();
    testAssembly();
    if (g_failures) { std::printf("\n%d check(s) failed\n", g_failures); return 1; }
    std::printf("\nall cluster selection checks passed\n");
    return 0;
}
