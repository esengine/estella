/**
 * @file    SpineModuleEntry.cpp
 * @brief   Standalone Spine WASM module entry point
 *
 * Pure computation module (no GL dependencies, no filesystem).
 * Handles: skeleton loading, animation update, mesh extraction.
 * Core WASM handles all rendering via renderer_submitTriangles.
 *
 * Uses spine-c (pure C runtime) for minimal WASM size.
 */

#include <emscripten.h>

#include <spine/spine.h>
#include <spine/extension.h>

#include <unordered_map>
#include <vector>
#include <string>
#include <cstring>
#include <cstdint>

// =============================================================================
// Spine-C Required Callbacks
// =============================================================================

void _spAtlasPage_createTexture(spAtlasPage* self, const char* path) {
    (void)self;
    (void)path;
}

void _spAtlasPage_disposeTexture(spAtlasPage* self) {
    (void)self;
}

char* _spUtil_readFile(const char* path, int* length) {
    (void)path;
    *length = 0;
    return nullptr;
}

// =============================================================================
// Texture ID Helpers
// =============================================================================

#ifdef ES_SPINE_38
static uint32_t getRegionTextureId(spRegionAttachment* attachment) {
    auto* region = reinterpret_cast<spAtlasRegion*>(attachment->rendererObject);
    if (!region || !region->page) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(region->page->rendererObject));
}

static uint32_t getMeshTextureId(spMeshAttachment* attachment) {
    auto* region = reinterpret_cast<spAtlasRegion*>(attachment->rendererObject);
    if (!region || !region->page) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(region->page->rendererObject));
}
#else
static uint32_t getRegionTextureId(spRegionAttachment* attachment) {
    if (!attachment->region) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(attachment->region->rendererObject));
}

static uint32_t getMeshTextureId(spMeshAttachment* attachment) {
    if (!attachment->region) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(attachment->region->rendererObject));
}
#endif

// =============================================================================
// Data Structures
// =============================================================================

struct SkeletonHandle {
    spAtlas* atlas = nullptr;
    spSkeletonData* skeletonData = nullptr;
    spAnimationStateData* stateData = nullptr;
};

struct SpineInstance {
    spSkeleton* skeleton = nullptr;
    spAnimationState* state = nullptr;
    int skeletonHandle = -1;
};

struct MeshBatch {
    std::vector<float> vertices;
    std::vector<uint16_t> indices;
    uint32_t textureId = 0;
    int blendMode = 0;
};

// =============================================================================
// Spine Context
// =============================================================================

struct SpineContext {
    std::unordered_map<int, SkeletonHandle> skeletons;
    std::unordered_map<int, SpineInstance> instances;
    int nextSkeletonId = 1;
    int nextInstanceId = 1;

    std::vector<MeshBatch> meshBatches;
    std::vector<float> worldVertices;

    // Spine's own clip region machinery (spSkeletonClipping), shared across
    // frames and lazily created. clippingEnabled is a global toggle (debug /
    // perf knob, default on) so a clip-on vs clip-off mesh can be compared.
    spSkeletonClipping* clipper = nullptr;
    bool clippingEnabled = true;

    std::string stringBuffer;
    std::string lastError;

    struct EventRecord {
        const char* animationName = nullptr;
        const char* eventName = nullptr;
        const char* stringValue = nullptr;
    };

    std::vector<float> eventBuffer;
    std::vector<EventRecord> eventRecords;
    int eventCount = 0;

    void reset() {
        for (auto& [id, inst] : instances) {
            if (inst.state) spAnimationState_dispose(inst.state);
            if (inst.skeleton) spSkeleton_dispose(inst.skeleton);
        }
        instances.clear();

        for (auto& [id, h] : skeletons) {
            if (h.stateData) spAnimationStateData_dispose(h.stateData);
            if (h.skeletonData) spSkeletonData_dispose(h.skeletonData);
            if (h.atlas) spAtlas_dispose(h.atlas);
        }
        skeletons.clear();

        nextSkeletonId = 1;
        nextInstanceId = 1;
        meshBatches.clear();
        worldVertices.clear();
        if (clipper) { spSkeletonClipping_dispose(clipper); clipper = nullptr; }
        stringBuffer.clear();
        lastError.clear();
        eventBuffer.clear();
        eventRecords.clear();
        eventCount = 0;
    }
};

static SpineContext g_ctx;

static void destroyInstance(SpineInstance& inst) {
    if (inst.state) spAnimationState_dispose(inst.state);
    if (inst.skeleton) spSkeleton_dispose(inst.skeleton);
}

static void destroySkeleton(SkeletonHandle& h) {
    if (h.stateData) spAnimationStateData_dispose(h.stateData);
    if (h.skeletonData) spSkeletonData_dispose(h.skeletonData);
    if (h.atlas) spAtlas_dispose(h.atlas);
}

// =============================================================================
// Resource Management
// =============================================================================

extern "C" {

EMSCRIPTEN_KEEPALIVE
int spine_loadSkeleton(uintptr_t skelDataPtr, int skelDataLen,
                       const char* atlasText, int atlasLen, int isBinary) {
    g_ctx.lastError.clear();

    int id = g_ctx.nextSkeletonId;
    auto& handle = g_ctx.skeletons[id];

    handle.atlas = spAtlas_create(atlasText, atlasLen, "", nullptr);
    if (!handle.atlas || !handle.atlas->pages) {
        g_ctx.lastError = "Failed to create atlas (invalid atlas text or no pages)";
        g_ctx.skeletons.erase(id);
        return -1;
    }

    if (isBinary) {
        spSkeletonBinary* binary = spSkeletonBinary_create(handle.atlas);
        if (!binary) {
            g_ctx.lastError = "Failed to create skeleton binary reader";
            destroySkeleton(handle);
            g_ctx.skeletons.erase(id);
            return -1;
        }
        binary->scale = 1.0f;
        handle.skeletonData = spSkeletonBinary_readSkeletonData(
            binary, reinterpret_cast<const unsigned char*>(skelDataPtr), skelDataLen);
        if (!handle.skeletonData && binary->error) {
            g_ctx.lastError = binary->error;
        }
        spSkeletonBinary_dispose(binary);
    } else {
        spSkeletonJson* json = spSkeletonJson_create(handle.atlas);
        if (!json) {
            g_ctx.lastError = "Failed to create skeleton json reader";
            destroySkeleton(handle);
            g_ctx.skeletons.erase(id);
            return -1;
        }
        json->scale = 1.0f;
        handle.skeletonData = spSkeletonJson_readSkeletonData(
            json, reinterpret_cast<const char*>(skelDataPtr));
        if (!handle.skeletonData && json->error) {
            g_ctx.lastError = json->error;
        }
        spSkeletonJson_dispose(json);
    }

    if (!handle.skeletonData) {
        destroySkeleton(handle);
        g_ctx.skeletons.erase(id);
        return -1;
    }

    handle.stateData = spAnimationStateData_create(handle.skeletonData);
    handle.stateData->defaultMix = 0.2f;

    g_ctx.nextSkeletonId++;
    return id;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getLastError() {
    return g_ctx.lastError.c_str();
}

EMSCRIPTEN_KEEPALIVE
void spine_unloadSkeleton(int handle) {
    auto it = g_ctx.skeletons.find(handle);
    if (it == g_ctx.skeletons.end()) return;

    std::vector<int> toRemove;
    for (auto& [id, inst] : g_ctx.instances) {
        if (inst.skeletonHandle == handle) {
            toRemove.push_back(id);
        }
    }
    for (int id : toRemove) {
        destroyInstance(g_ctx.instances[id]);
        g_ctx.instances.erase(id);
    }

    destroySkeleton(it->second);
    g_ctx.skeletons.erase(it);
}

EMSCRIPTEN_KEEPALIVE
int spine_getAtlasPageCount(int handle) {
    auto it = g_ctx.skeletons.find(handle);
    if (it == g_ctx.skeletons.end()) return 0;
    int count = 0;
    spAtlasPage* page = it->second.atlas->pages;
    while (page) {
        count++;
        page = page->next;
    }
    return count;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getAtlasPageTextureName(int handle, int pageIndex) {
    auto it = g_ctx.skeletons.find(handle);
    if (it == g_ctx.skeletons.end()) return "";
    spAtlasPage* page = it->second.atlas->pages;
    for (int i = 0; i < pageIndex && page; i++) {
        page = page->next;
    }
    if (!page) return "";
    g_ctx.stringBuffer = page->name;
    return g_ctx.stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
void spine_setAtlasPageTexture(int handle, int pageIndex,
                                uint32_t textureId, int width, int height) {
    auto it = g_ctx.skeletons.find(handle);
    if (it == g_ctx.skeletons.end()) return;
    spAtlasPage* page = it->second.atlas->pages;
    for (int i = 0; i < pageIndex && page; i++) {
        page = page->next;
    }
    if (!page) return;

    void* texPtr = reinterpret_cast<void*>(static_cast<uintptr_t>(textureId));
    page->rendererObject = texPtr;
    page->width = width;
    page->height = height;

#ifndef ES_SPINE_38
    spAtlasRegion* region = it->second.atlas->regions;
    while (region) {
        if (region->page == page) {
            region->super.rendererObject = texPtr;
        }
        region = region->next;
    }
#endif
}

// =============================================================================
// Instance Management
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_createInstance(int skeletonHandle) {
    auto it = g_ctx.skeletons.find(skeletonHandle);
    if (it == g_ctx.skeletons.end()) return -1;

    int id = g_ctx.nextInstanceId;
    auto& inst = g_ctx.instances[id];
    inst.skeletonHandle = skeletonHandle;
    inst.skeleton = spSkeleton_create(it->second.skeletonData);
    inst.state = spAnimationState_create(it->second.stateData);
    spSkeleton_setToSetupPose(inst.skeleton);
#if defined(ES_SPINE_38) || defined(ES_SPINE_41)
    spSkeleton_updateWorldTransform(inst.skeleton);
#else
    spSkeleton_updateWorldTransform(inst.skeleton, SP_PHYSICS_UPDATE);
#endif

    g_ctx.nextInstanceId++;
    return id;
}

EMSCRIPTEN_KEEPALIVE
void spine_destroyInstance(int instanceId) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return;
    destroyInstance(it->second);
    g_ctx.instances.erase(it);
}

// =============================================================================
// Animation Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_playAnimation(int instanceId, const char* name, int loop, int track) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;
    spTrackEntry* entry = spAnimationState_setAnimationByName(
        it->second.state, track, name, loop);
    return entry ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int spine_addAnimation(int instanceId, const char* name,
                       int loop, float delay, int track) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;
    spTrackEntry* entry = spAnimationState_addAnimationByName(
        it->second.state, track, name, loop, delay);
    return entry ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void spine_setSkin(int instanceId, const char* name) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return;

    if (!name || name[0] == '\0') {
        spSkeleton_setSkin(it->second.skeleton, nullptr);
    } else {
        spSkeleton_setSkinByName(it->second.skeleton, name);
    }
    spSkeleton_setSlotsToSetupPose(it->second.skeleton);
}

EMSCRIPTEN_KEEPALIVE
void spine_update(int instanceId, float dt) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return;

    g_ctx.eventBuffer.clear();
    g_ctx.eventCount = 0;

    spAnimationState_update(it->second.state, dt);
    spAnimationState_apply(it->second.state, it->second.skeleton);
#if defined(ES_SPINE_38) || defined(ES_SPINE_41)
    spSkeleton_updateWorldTransform(it->second.skeleton);
#else
    spSkeleton_update(it->second.skeleton, dt);
    spSkeleton_updateWorldTransform(it->second.skeleton, SP_PHYSICS_UPDATE);
#endif
}

// =============================================================================
// Query
// =============================================================================

EMSCRIPTEN_KEEPALIVE
const char* spine_getAnimations(int instanceId) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) {
        g_ctx.stringBuffer = "[]";
        return g_ctx.stringBuffer.c_str();
    }

    spSkeletonData* data = it->second.skeleton->data;
    g_ctx.stringBuffer = "[";
    for (int i = 0; i < data->animationsCount; ++i) {
        if (i > 0) g_ctx.stringBuffer += ",";
        g_ctx.stringBuffer += "\"";
        g_ctx.stringBuffer += data->animations[i]->name;
        g_ctx.stringBuffer += "\"";
    }
    g_ctx.stringBuffer += "]";
    return g_ctx.stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getSkins(int instanceId) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) {
        g_ctx.stringBuffer = "[]";
        return g_ctx.stringBuffer.c_str();
    }

    spSkeletonData* data = it->second.skeleton->data;
    g_ctx.stringBuffer = "[";
    for (int i = 0; i < data->skinsCount; ++i) {
        if (i > 0) g_ctx.stringBuffer += ",";
        g_ctx.stringBuffer += "\"";
        g_ctx.stringBuffer += data->skins[i]->name;
        g_ctx.stringBuffer += "\"";
    }
    g_ctx.stringBuffer += "]";
    return g_ctx.stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
int spine_getBonePosition(int instanceId, const char* bone,
                          uintptr_t outXPtr, uintptr_t outYPtr) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;

    spBone* b = spSkeleton_findBone(it->second.skeleton, bone);
    if (!b) return 0;

    *reinterpret_cast<float*>(outXPtr) = b->worldX;
    *reinterpret_cast<float*>(outYPtr) = b->worldY;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
float spine_getBoneRotation(int instanceId, const char* bone) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0.0f;

    spBone* b = spSkeleton_findBone(it->second.skeleton, bone);
    if (!b) return 0.0f;

    return spBone_getWorldRotationX(b);
}

EMSCRIPTEN_KEEPALIVE
void spine_getBounds(int instanceId, uintptr_t outXPtr, uintptr_t outYPtr,
                      uintptr_t outWPtr, uintptr_t outHPtr) {
    auto* outX = reinterpret_cast<float*>(outXPtr);
    auto* outY = reinterpret_cast<float*>(outYPtr);
    auto* outW = reinterpret_cast<float*>(outWPtr);
    auto* outH = reinterpret_cast<float*>(outHPtr);

    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) {
        *outX = *outY = *outW = *outH = 0;
        return;
    }

    spSkeleton* skeleton = it->second.skeleton;
    float minX = 1e30f, minY = 1e30f, maxX = -1e30f, maxY = -1e30f;
    bool hasVerts = false;

    for (int i = 0; i < skeleton->slotsCount; i++) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot->attachment) continue;

        float* verts = nullptr;
        int vertCount = 0;

        if (slot->attachment->type == SP_ATTACHMENT_REGION) {
            auto* region = reinterpret_cast<spRegionAttachment*>(slot->attachment);
            g_ctx.worldVertices.resize(8);
#ifdef ES_SPINE_38
            spRegionAttachment_computeWorldVertices(region, slot->bone, g_ctx.worldVertices.data(), 0, 2);
#else
            spRegionAttachment_computeWorldVertices(region, slot, g_ctx.worldVertices.data(), 0, 2);
#endif
            verts = g_ctx.worldVertices.data();
            vertCount = 4;
        } else if (slot->attachment->type == SP_ATTACHMENT_MESH) {
            auto* mesh = reinterpret_cast<spMeshAttachment*>(slot->attachment);
            vertCount = SUPER(mesh)->worldVerticesLength / 2;
            g_ctx.worldVertices.resize(SUPER(mesh)->worldVerticesLength);
            spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0,
                SUPER(mesh)->worldVerticesLength, g_ctx.worldVertices.data(), 0, 2);
            verts = g_ctx.worldVertices.data();
        }

        if (verts && vertCount > 0) {
            hasVerts = true;
            for (int j = 0; j < vertCount; j++) {
                float x = verts[j * 2];
                float y = verts[j * 2 + 1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (hasVerts) {
        *outX = minX;
        *outY = minY;
        *outW = maxX - minX;
        *outH = maxY - minY;
    } else {
        *outX = *outY = *outW = *outH = 0;
    }
}

// =============================================================================
// Mesh Extraction
// =============================================================================

// Emit one attachment's triangles into the current batch, applying the active
// clip region when clipping is on. Uses spine's own spSkeletonClipping — the
// same algorithm the native path used — so 4.2 (which routes here once a
// provider is configured) finally clips instead of dropping the clip silently.
// `verts`/`uvs` are x,y / u,v interleaved; `tris` index into `verts`. Clipping
// replaces the triangle set with the polygon intersection, never expanding it.
static void emitClippedTriangles(
    MeshBatch*& currentBatch, uint32_t& currentTexture, int& currentBlend,
    float* verts, int vertCount, float* uvs,
    unsigned short* tris, int triCount,
    uint32_t texId, int effectiveBlend,
    float r, float g, float b, float a
) {
    float* outVerts = verts;
    float* outUVs = uvs;
    unsigned short* outTris = tris;
    int outVertCount = vertCount;
    int outTriCount = triCount;

    if (g_ctx.clippingEnabled && spSkeletonClipping_isClipping(g_ctx.clipper)) {
        spSkeletonClipping_clipTriangles(
            g_ctx.clipper, verts, vertCount * 2, tris, triCount, uvs, 2);
        outVerts = g_ctx.clipper->clippedVertices->items;
        outVertCount = g_ctx.clipper->clippedVertices->size / 2;
        outUVs = g_ctx.clipper->clippedUVs->items;
        outTris = g_ctx.clipper->clippedTriangles->items;
        outTriCount = g_ctx.clipper->clippedTriangles->size;
    }

    if (outVertCount == 0 || outTriCount == 0) return;

    bool needNewBatch = !currentBatch || texId != currentTexture || effectiveBlend != currentBlend;
    if (!needNewBatch && currentBatch->vertices.size() / 8 + outVertCount > 65535) {
        needNewBatch = true;
    }
    if (needNewBatch) {
        g_ctx.meshBatches.emplace_back();
        currentBatch = &g_ctx.meshBatches.back();
        currentBatch->textureId = texId;
        currentBatch->blendMode = effectiveBlend;
        currentTexture = texId;
        currentBlend = effectiveBlend;
    }

    auto baseIndex = static_cast<uint16_t>(currentBatch->vertices.size() / 8);
    for (int j = 0; j < outVertCount; ++j) {
        currentBatch->vertices.push_back(outVerts[j * 2]);
        currentBatch->vertices.push_back(outVerts[j * 2 + 1]);
        currentBatch->vertices.push_back(outUVs[j * 2]);
        currentBatch->vertices.push_back(outUVs[j * 2 + 1]);
        currentBatch->vertices.push_back(r);
        currentBatch->vertices.push_back(g);
        currentBatch->vertices.push_back(b);
        currentBatch->vertices.push_back(a);
    }
    for (int j = 0; j < outTriCount; ++j) {
        currentBatch->indices.push_back(static_cast<uint16_t>(baseIndex + outTris[j]));
    }
}

static void extractMeshBatches(int instanceId) {
    g_ctx.meshBatches.clear();

    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return;

    if (!g_ctx.clipper) g_ctx.clipper = spSkeletonClipping_create();

    spSkeleton* skeleton = it->second.skeleton;
    spColor& skelColor = skeleton->color;

    MeshBatch* currentBatch = nullptr;
    uint32_t currentTexture = 0;
    int currentBlend = 0;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot) continue;

        spAttachment* attachment = slot->attachment;

        // A clipping attachment opens a clip region (until its endSlot); it emits
        // no geometry itself.
        if (attachment && attachment->type == SP_ATTACHMENT_CLIPPING) {
            if (g_ctx.clippingEnabled) {
                spSkeletonClipping_clipStart(g_ctx.clipper, slot,
                    reinterpret_cast<spClippingAttachment*>(attachment));
            }
            continue;
        }

        bool visible = attachment != nullptr;
#if !defined(ES_SPINE_38) && !defined(ES_SPINE_41)
        if (visible && !slot->data->visible) visible = false;
#endif

        if (visible) {
            spColor& slotColor = slot->color;

            int blendMode = 0;
            switch (slot->data->blendMode) {
                case SP_BLEND_MODE_NORMAL: blendMode = 0; break;
                case SP_BLEND_MODE_ADDITIVE: blendMode = 1; break;
                case SP_BLEND_MODE_MULTIPLY: blendMode = 2; break;
                case SP_BLEND_MODE_SCREEN: blendMode = 3; break;
            }

            if (attachment->type == SP_ATTACHMENT_REGION) {
                auto* region = reinterpret_cast<spRegionAttachment*>(attachment);
                uint32_t texId = getRegionTextureId(region);
                if (texId) {
                    g_ctx.worldVertices.resize(8);
#ifdef ES_SPINE_38
                    spRegionAttachment_computeWorldVertices(region, slot->bone, g_ctx.worldVertices.data(), 0, 2);
#else
                    spRegionAttachment_computeWorldVertices(region, slot, g_ctx.worldVertices.data(), 0, 2);
#endif
                    int effectiveBlend = blendMode;
#ifndef ES_SPINE_38
                    if (region->region) {
                        auto* atlasReg = reinterpret_cast<spAtlasRegion*>(region->region);
                        if (atlasReg->page && atlasReg->page->pma) {
                            if (effectiveBlend == 0) effectiveBlend = 4;
                            else if (effectiveBlend == 1) effectiveBlend = 5;
                        }
                    }
#endif
                    spColor& attachColor = region->color;
                    float a = skelColor.a * slotColor.a * attachColor.a;
                    float r = skelColor.r * slotColor.r * attachColor.r;
                    float g = skelColor.g * slotColor.g * attachColor.g;
                    float b = skelColor.b * slotColor.b * attachColor.b;
                    if (effectiveBlend >= 4) { r *= a; g *= a; b *= a; }

                    static unsigned short QUAD_TRIS[6] = {0, 1, 2, 2, 3, 0};
                    emitClippedTriangles(currentBatch, currentTexture, currentBlend,
                        g_ctx.worldVertices.data(), 4, region->uvs, QUAD_TRIS, 6,
                        texId, effectiveBlend, r, g, b, a);
                }
            } else if (attachment->type == SP_ATTACHMENT_MESH) {
                auto* mesh = reinterpret_cast<spMeshAttachment*>(attachment);
                uint32_t texId = getMeshTextureId(mesh);
                if (texId) {
                    int worldVerticesLength = SUPER(mesh)->worldVerticesLength;
                    int vertexCount = worldVerticesLength / 2;
                    g_ctx.worldVertices.resize(worldVerticesLength);
                    spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0,
                        worldVerticesLength, g_ctx.worldVertices.data(), 0, 2);

                    int effectiveBlend = blendMode;
#ifndef ES_SPINE_38
                    if (mesh->region) {
                        auto* atlasReg = reinterpret_cast<spAtlasRegion*>(mesh->region);
                        if (atlasReg->page && atlasReg->page->pma) {
                            if (effectiveBlend == 0) effectiveBlend = 4;
                            else if (effectiveBlend == 1) effectiveBlend = 5;
                        }
                    }
#endif
                    spColor& attachColor = mesh->color;
                    float a = skelColor.a * slotColor.a * attachColor.a;
                    float r = skelColor.r * slotColor.r * attachColor.r;
                    float g = skelColor.g * slotColor.g * attachColor.g;
                    float b = skelColor.b * slotColor.b * attachColor.b;
                    if (effectiveBlend >= 4) { r *= a; g *= a; b *= a; }

                    emitClippedTriangles(currentBatch, currentTexture, currentBlend,
                        g_ctx.worldVertices.data(), vertexCount, mesh->uvs,
                        mesh->triangles, mesh->trianglesCount,
                        texId, effectiveBlend, r, g, b, a);
                }
            }
        }

        // clipEnd closes the region when this slot is the clip's endSlot
        // (cheap no-op otherwise). Called for every non-clip slot, per spine.
        if (g_ctx.clippingEnabled) {
            spSkeletonClipping_clipEnd(g_ctx.clipper, slot);
        }
    }

    if (g_ctx.clippingEnabled) {
        spSkeletonClipping_clipEnd2(g_ctx.clipper);
    }
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchCount(int instanceId) {
    extractMeshBatches(instanceId);
    return static_cast<int>(g_ctx.meshBatches.size());
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchVertexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.meshBatches.size())) return 0;
    return static_cast<int>(g_ctx.meshBatches[batchIndex].vertices.size() / 8);
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchIndexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.meshBatches.size())) return 0;
    return static_cast<int>(g_ctx.meshBatches[batchIndex].indices.size());
}

EMSCRIPTEN_KEEPALIVE
void spine_getMeshBatchData(int instanceId, int batchIndex,
                             uintptr_t outVerticesPtr, uintptr_t outIndicesPtr,
                             uintptr_t outTextureIdPtr, uintptr_t outBlendModePtr) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_ctx.meshBatches.size())) return;

    auto& batch = g_ctx.meshBatches[batchIndex];

    auto* outVertices = reinterpret_cast<float*>(outVerticesPtr);
    auto* outIndices = reinterpret_cast<uint16_t*>(outIndicesPtr);
    auto* outTextureId = reinterpret_cast<uint32_t*>(outTextureIdPtr);
    auto* outBlendMode = reinterpret_cast<int*>(outBlendModePtr);

    std::memcpy(outVertices, batch.vertices.data(),
                batch.vertices.size() * sizeof(float));
    std::memcpy(outIndices, batch.indices.data(),
                batch.indices.size() * sizeof(uint16_t));
    *outTextureId = batch.textureId;
    *outBlendMode = batch.blendMode;
}

// Toggle clip-region processing (default on). Lets a caller compare clip-on vs
// clip-off output; also a perf escape hatch for scenes with no clip regions.
EMSCRIPTEN_KEEPALIVE
void spine_setClippingEnabled(int enabled) {
    g_ctx.clippingEnabled = enabled != 0;
}

// =============================================================================
// Mix Duration / Track Alpha
// =============================================================================

EMSCRIPTEN_KEEPALIVE
void spine_setDefaultMix(int skeletonHandle, float duration) {
    auto it = g_ctx.skeletons.find(skeletonHandle);
    if (it == g_ctx.skeletons.end() || !it->second.stateData) return;
    it->second.stateData->defaultMix = duration;
}

EMSCRIPTEN_KEEPALIVE
void spine_setMixDuration(int skeletonHandle, const char* fromAnim,
                           const char* toAnim, float duration) {
    auto it = g_ctx.skeletons.find(skeletonHandle);
    if (it == g_ctx.skeletons.end() || !it->second.stateData) return;

    spAnimation* from = spSkeletonData_findAnimation(it->second.skeletonData, fromAnim);
    spAnimation* to = spSkeletonData_findAnimation(it->second.skeletonData, toAnim);
    if (!from || !to) return;

    spAnimationStateData_setMix(it->second.stateData, from, to, duration);
}

EMSCRIPTEN_KEEPALIVE
void spine_setTrackAlpha(int instanceId, int track, float alpha) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return;

    spTrackEntry* entry = spAnimationState_getCurrent(it->second.state, track);
    if (entry) {
        entry->alpha = alpha;
    }
}

// =============================================================================
// Event Collection
// =============================================================================

static constexpr int EVENT_STRIDE = 4;
static constexpr int MAX_EVENTS_PER_UPDATE = 64;

static void spineEventListener(spAnimationState* state, spEventType type,
                                spTrackEntry* entry, spEvent* event) {
    (void)state;
    if (g_ctx.eventCount >= MAX_EVENTS_PER_UPDATE) return;

    float typeF;
    int typeInt = static_cast<int>(type);
    std::memcpy(&typeF, &typeInt, sizeof(float));
    g_ctx.eventBuffer.push_back(typeF);

    float trackF;
    int trackInt = entry ? entry->trackIndex : 0;
    std::memcpy(&trackF, &trackInt, sizeof(float));
    g_ctx.eventBuffer.push_back(trackF);

    if (type == SP_ANIMATION_EVENT && event) {
        g_ctx.eventBuffer.push_back(event->floatValue);
        float intValF;
        int intVal = event->intValue;
        std::memcpy(&intValF, &intVal, sizeof(float));
        g_ctx.eventBuffer.push_back(intValF);
    } else {
        g_ctx.eventBuffer.push_back(0.0f);
        g_ctx.eventBuffer.push_back(0.0f);
    }

    SpineContext::EventRecord record{};
    record.animationName = (entry && entry->animation) ? entry->animation->name : nullptr;
    if (type == SP_ANIMATION_EVENT && event) {
        record.eventName = event->data->name;
        record.stringValue = event->stringValue;
    }
    g_ctx.eventRecords.push_back(record);

    g_ctx.eventCount++;
}

EMSCRIPTEN_KEEPALIVE
void spine_enableEvents(int instanceId) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return;
    it->second.state->listener = spineEventListener;
}

EMSCRIPTEN_KEEPALIVE
int spine_getEventCount(int instanceId) {
    (void)instanceId;
    return g_ctx.eventCount;
}

EMSCRIPTEN_KEEPALIVE
uintptr_t spine_getEventBuffer() {
    return reinterpret_cast<uintptr_t>(g_ctx.eventBuffer.data());
}

EMSCRIPTEN_KEEPALIVE
void spine_clearEvents() {
    g_ctx.eventBuffer.clear();
    g_ctx.eventRecords.clear();
    g_ctx.eventCount = 0;
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventAnimationName(int index) {
    if (index < 0 || index >= g_ctx.eventCount) return "";
    auto name = g_ctx.eventRecords[index].animationName;
    return name ? name : "";
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventName(int index) {
    if (index < 0 || index >= g_ctx.eventCount) return "";
    auto name = g_ctx.eventRecords[index].eventName;
    return name ? name : "";
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getEventStringValue(int index) {
    if (index < 0 || index >= g_ctx.eventCount) return "";
    auto val = g_ctx.eventRecords[index].stringValue;
    return val ? val : "";
}

// =============================================================================
// Attachment Manipulation
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_setAttachment(int instanceId, const char* slotName,
                         const char* attachmentName) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;

    int result = spSkeleton_setAttachment(
        it->second.skeleton, slotName,
        (attachmentName && attachmentName[0] != '\0') ? attachmentName : nullptr);
    return result;
}

// =============================================================================
// IK Constraint Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_setIKTarget(int instanceId, const char* constraintName,
                       float targetX, float targetY, float mix) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;

    spIkConstraint* constraint = spSkeleton_findIkConstraint(
        it->second.skeleton, constraintName);
    if (!constraint) return 0;

    constraint->target->x = targetX;
    constraint->target->y = targetY;
    constraint->mix = mix;
    return 1;
}

// =============================================================================
// Transform Constraint Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
const char* spine_listConstraints(int instanceId) {
    static std::string jsonBuf;
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return "{}";

    auto* skeleton = it->second.skeleton;
    jsonBuf = "{\"ik\":[";
    for (int i = 0; i < skeleton->ikConstraintsCount; ++i) {
        if (i > 0) jsonBuf += ',';
        jsonBuf += '"';
        jsonBuf += skeleton->ikConstraints[i]->data->name;
        jsonBuf += '"';
    }
    jsonBuf += "],\"transform\":[";
    for (int i = 0; i < skeleton->transformConstraintsCount; ++i) {
        if (i > 0) jsonBuf += ',';
        jsonBuf += '"';
        jsonBuf += skeleton->transformConstraints[i]->data->name;
        jsonBuf += '"';
    }
    jsonBuf += "],\"path\":[";
    for (int i = 0; i < skeleton->pathConstraintsCount; ++i) {
        if (i > 0) jsonBuf += ',';
        jsonBuf += '"';
        jsonBuf += skeleton->pathConstraints[i]->data->name;
        jsonBuf += '"';
    }
    jsonBuf += "]}";
    return jsonBuf.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getTransformConstraintMix(int instanceId, const char* name) {
    static std::string jsonBuf;
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return "";

    auto* constraint = spSkeleton_findTransformConstraint(it->second.skeleton, name);
    if (!constraint) return "";

    char buf[256];
#ifdef ES_SPINE_38
    snprintf(buf, sizeof(buf),
        "{\"mixRotate\":%.6g,\"mixX\":%.6g,\"mixY\":%.6g,\"mixScaleX\":%.6g,\"mixScaleY\":%.6g,\"mixShearY\":%.6g}",
        constraint->rotateMix, constraint->translateMix, constraint->translateMix,
        constraint->scaleMix, constraint->scaleMix, constraint->shearMix);
#else
    snprintf(buf, sizeof(buf),
        "{\"mixRotate\":%.6g,\"mixX\":%.6g,\"mixY\":%.6g,\"mixScaleX\":%.6g,\"mixScaleY\":%.6g,\"mixShearY\":%.6g}",
        constraint->mixRotate, constraint->mixX, constraint->mixY,
        constraint->mixScaleX, constraint->mixScaleY, constraint->mixShearY);
#endif
    jsonBuf = buf;
    return jsonBuf.c_str();
}

EMSCRIPTEN_KEEPALIVE
int spine_setTransformConstraintMix(int instanceId, const char* name,
    float rotate, float x, float y, float scaleX, float scaleY, float shearY) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;

    auto* constraint = spSkeleton_findTransformConstraint(it->second.skeleton, name);
    if (!constraint) return 0;

#ifdef ES_SPINE_38
    constraint->rotateMix = rotate;
    constraint->translateMix = (x + y) * 0.5f;
    constraint->scaleMix = (scaleX + scaleY) * 0.5f;
    constraint->shearMix = shearY;
#else
    constraint->mixRotate = rotate;
    constraint->mixX = x;
    constraint->mixY = y;
    constraint->mixScaleX = scaleX;
    constraint->mixScaleY = scaleY;
    constraint->mixShearY = shearY;
#endif
    return 1;
}

// =============================================================================
// Path Constraint Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
const char* spine_getPathConstraintMix(int instanceId, const char* name) {
    static std::string jsonBuf;
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return "";

    auto* constraint = spSkeleton_findPathConstraint(it->second.skeleton, name);
    if (!constraint) return "";

    char buf[256];
#ifdef ES_SPINE_38
    snprintf(buf, sizeof(buf),
        "{\"position\":%.6g,\"spacing\":%.6g,\"mixRotate\":%.6g,\"mixX\":%.6g,\"mixY\":%.6g}",
        constraint->position, constraint->spacing,
        constraint->rotateMix, constraint->translateMix, constraint->translateMix);
#else
    snprintf(buf, sizeof(buf),
        "{\"position\":%.6g,\"spacing\":%.6g,\"mixRotate\":%.6g,\"mixX\":%.6g,\"mixY\":%.6g}",
        constraint->position, constraint->spacing,
        constraint->mixRotate, constraint->mixX, constraint->mixY);
#endif
    jsonBuf = buf;
    return jsonBuf.c_str();
}

EMSCRIPTEN_KEEPALIVE
int spine_setPathConstraintMix(int instanceId, const char* name,
    float position, float spacing, float rotate, float x, float y) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;

    auto* constraint = spSkeleton_findPathConstraint(it->second.skeleton, name);
    if (!constraint) return 0;

    constraint->position = position;
    constraint->spacing = spacing;
#ifdef ES_SPINE_38
    constraint->rotateMix = rotate;
    constraint->translateMix = (x + y) * 0.5f;
#else
    constraint->mixRotate = rotate;
    constraint->mixX = x;
    constraint->mixY = y;
#endif
    return 1;
}

// =============================================================================
// Slot Color Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_setSlotColor(int instanceId, const char* slotName,
                        float r, float g, float b, float a) {
    auto it = g_ctx.instances.find(instanceId);
    if (it == g_ctx.instances.end()) return 0;

    spSlot* slot = spSkeleton_findSlot(it->second.skeleton, slotName);
    if (!slot) return 0;

    slot->color.r = r;
    slot->color.g = g;
    slot->color.b = b;
    slot->color.a = a;
    return 1;
}

} // extern "C"

int main() {
    return 0;
}
