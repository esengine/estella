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

static std::unordered_map<int, SkeletonHandle> g_skeletons;
static std::unordered_map<int, SpineInstance> g_instances;
static int g_nextSkeletonId = 1;
static int g_nextInstanceId = 1;

static std::vector<MeshBatch> g_meshBatches;
static std::vector<float> g_worldVertices;

static std::string g_stringBuffer;

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
    int id = g_nextSkeletonId;
    auto& handle = g_skeletons[id];

    handle.atlas = spAtlas_create(atlasText, atlasLen, "", nullptr);
    if (!handle.atlas || !handle.atlas->pages) {
        g_skeletons.erase(id);
        return -1;
    }

    if (isBinary) {
        spSkeletonBinary* binary = spSkeletonBinary_create(handle.atlas);
        binary->scale = 1.0f;
        handle.skeletonData = spSkeletonBinary_readSkeletonData(
            binary, reinterpret_cast<const unsigned char*>(skelDataPtr), skelDataLen);
        spSkeletonBinary_dispose(binary);
    } else {
        spSkeletonJson* json = spSkeletonJson_create(handle.atlas);
        json->scale = 1.0f;
        handle.skeletonData = spSkeletonJson_readSkeletonData(
            json, reinterpret_cast<const char*>(skelDataPtr));
        spSkeletonJson_dispose(json);
    }

    if (!handle.skeletonData) {
        destroySkeleton(handle);
        g_skeletons.erase(id);
        return -1;
    }

    handle.stateData = spAnimationStateData_create(handle.skeletonData);
    handle.stateData->defaultMix = 0.2f;

    g_nextSkeletonId++;
    return id;
}

EMSCRIPTEN_KEEPALIVE
void spine_unloadSkeleton(int handle) {
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return;

    std::vector<int> toRemove;
    for (auto& [id, inst] : g_instances) {
        if (inst.skeletonHandle == handle) {
            toRemove.push_back(id);
        }
    }
    for (int id : toRemove) {
        destroyInstance(g_instances[id]);
        g_instances.erase(id);
    }

    destroySkeleton(it->second);
    g_skeletons.erase(it);
}

EMSCRIPTEN_KEEPALIVE
int spine_getAtlasPageCount(int handle) {
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return 0;
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
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return "";
    spAtlasPage* page = it->second.atlas->pages;
    for (int i = 0; i < pageIndex && page; i++) {
        page = page->next;
    }
    if (!page) return "";
    g_stringBuffer = page->name;
    return g_stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
void spine_setAtlasPageTexture(int handle, int pageIndex,
                                uint32_t textureId, int width, int height) {
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return;
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
    auto it = g_skeletons.find(skeletonHandle);
    if (it == g_skeletons.end()) return -1;

    int id = g_nextInstanceId;
    auto& inst = g_instances[id];
    inst.skeletonHandle = skeletonHandle;
    inst.skeleton = spSkeleton_create(it->second.skeletonData);
    inst.state = spAnimationState_create(it->second.stateData);
    spSkeleton_setToSetupPose(inst.skeleton);
#ifdef ES_SPINE_38
    spSkeleton_updateWorldTransform(inst.skeleton);
#else
    spSkeleton_updateWorldTransform(inst.skeleton, SP_PHYSICS_UPDATE);
#endif

    g_nextInstanceId++;
    return id;
}

EMSCRIPTEN_KEEPALIVE
void spine_destroyInstance(int instanceId) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;
    destroyInstance(it->second);
    g_instances.erase(it);
}

// =============================================================================
// Animation Control
// =============================================================================

EMSCRIPTEN_KEEPALIVE
int spine_playAnimation(int instanceId, const char* name, int loop, int track) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return 0;
    spTrackEntry* entry = spAnimationState_setAnimationByName(
        it->second.state, track, name, loop);
    return entry ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int spine_addAnimation(int instanceId, const char* name,
                       int loop, float delay, int track) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return 0;
    spTrackEntry* entry = spAnimationState_addAnimationByName(
        it->second.state, track, name, loop, delay);
    return entry ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void spine_setSkin(int instanceId, const char* name) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;

    if (!name || name[0] == '\0') {
        spSkeleton_setSkin(it->second.skeleton, nullptr);
    } else {
        spSkeleton_setSkinByName(it->second.skeleton, name);
    }
    spSkeleton_setSlotsToSetupPose(it->second.skeleton);
}

EMSCRIPTEN_KEEPALIVE
void spine_update(int instanceId, float dt) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;

    spAnimationState_update(it->second.state, dt);
    spAnimationState_apply(it->second.state, it->second.skeleton);
#ifdef ES_SPINE_38
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
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) {
        g_stringBuffer = "[]";
        return g_stringBuffer.c_str();
    }

    spSkeletonData* data = it->second.skeleton->data;
    g_stringBuffer = "[";
    for (int i = 0; i < data->animationsCount; ++i) {
        if (i > 0) g_stringBuffer += ",";
        g_stringBuffer += "\"";
        g_stringBuffer += data->animations[i]->name;
        g_stringBuffer += "\"";
    }
    g_stringBuffer += "]";
    return g_stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
const char* spine_getSkins(int instanceId) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) {
        g_stringBuffer = "[]";
        return g_stringBuffer.c_str();
    }

    spSkeletonData* data = it->second.skeleton->data;
    g_stringBuffer = "[";
    for (int i = 0; i < data->skinsCount; ++i) {
        if (i > 0) g_stringBuffer += ",";
        g_stringBuffer += "\"";
        g_stringBuffer += data->skins[i]->name;
        g_stringBuffer += "\"";
    }
    g_stringBuffer += "]";
    return g_stringBuffer.c_str();
}

EMSCRIPTEN_KEEPALIVE
int spine_getBonePosition(int instanceId, const char* bone,
                          uintptr_t outXPtr, uintptr_t outYPtr) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return 0;

    spBone* b = spSkeleton_findBone(it->second.skeleton, bone);
    if (!b) return 0;

    *reinterpret_cast<float*>(outXPtr) = b->worldX;
    *reinterpret_cast<float*>(outYPtr) = b->worldY;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
float spine_getBoneRotation(int instanceId, const char* bone) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return 0.0f;

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

    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) {
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
            g_worldVertices.resize(8);
#ifdef ES_SPINE_38
            spRegionAttachment_computeWorldVertices(region, slot->bone, g_worldVertices.data(), 0, 2);
#else
            spRegionAttachment_computeWorldVertices(region, slot, g_worldVertices.data(), 0, 2);
#endif
            verts = g_worldVertices.data();
            vertCount = 4;
        } else if (slot->attachment->type == SP_ATTACHMENT_MESH) {
            auto* mesh = reinterpret_cast<spMeshAttachment*>(slot->attachment);
            vertCount = SUPER(mesh)->worldVerticesLength / 2;
            g_worldVertices.resize(SUPER(mesh)->worldVerticesLength);
            spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0,
                SUPER(mesh)->worldVerticesLength, g_worldVertices.data(), 0, 2);
            verts = g_worldVertices.data();
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

static void extractMeshBatches(int instanceId) {
    g_meshBatches.clear();

    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;

    spSkeleton* skeleton = it->second.skeleton;
    spColor& skelColor = skeleton->color;

    MeshBatch* currentBatch = nullptr;
    uint32_t currentTexture = 0;
    int currentBlend = 0;

    for (int i = 0; i < skeleton->slotsCount; ++i) {
        spSlot* slot = skeleton->drawOrder[i];
        if (!slot) continue;

        spAttachment* attachment = slot->attachment;
        if (!attachment) continue;
#ifndef ES_SPINE_38
        if (!slot->data->visible) continue;
#endif

        if (attachment->type == SP_ATTACHMENT_CLIPPING) {
            continue;
        }

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
            if (!texId) continue;

            if (!currentBatch || texId != currentTexture || blendMode != currentBlend) {
                g_meshBatches.emplace_back();
                currentBatch = &g_meshBatches.back();
                currentBatch->textureId = texId;
                currentBatch->blendMode = blendMode;
                currentTexture = texId;
                currentBlend = blendMode;
            }

            g_worldVertices.resize(8);
#ifdef ES_SPINE_38
            spRegionAttachment_computeWorldVertices(region, slot->bone, g_worldVertices.data(), 0, 2);
#else
            spRegionAttachment_computeWorldVertices(region, slot, g_worldVertices.data(), 0, 2);
#endif

            float* uvs = region->uvs;
            spColor& attachColor = region->color;

            float r = skelColor.r * slotColor.r * attachColor.r;
            float g = skelColor.g * slotColor.g * attachColor.g;
            float b = skelColor.b * slotColor.b * attachColor.b;
            float a = skelColor.a * slotColor.a * attachColor.a;

            auto baseIndex = static_cast<uint16_t>(
                currentBatch->vertices.size() / 8);

            for (int j = 0; j < 4; ++j) {
                currentBatch->vertices.push_back(g_worldVertices[j * 2]);
                currentBatch->vertices.push_back(g_worldVertices[j * 2 + 1]);
                currentBatch->vertices.push_back(uvs[j * 2]);
                currentBatch->vertices.push_back(uvs[j * 2 + 1]);
                currentBatch->vertices.push_back(r);
                currentBatch->vertices.push_back(g);
                currentBatch->vertices.push_back(b);
                currentBatch->vertices.push_back(a);
            }

            currentBatch->indices.push_back(baseIndex);
            currentBatch->indices.push_back(baseIndex + 1);
            currentBatch->indices.push_back(baseIndex + 2);
            currentBatch->indices.push_back(baseIndex + 2);
            currentBatch->indices.push_back(baseIndex + 3);
            currentBatch->indices.push_back(baseIndex);

        } else if (attachment->type == SP_ATTACHMENT_MESH) {
            auto* mesh = reinterpret_cast<spMeshAttachment*>(attachment);

            uint32_t texId = getMeshTextureId(mesh);
            if (!texId) continue;

            if (!currentBatch || texId != currentTexture || blendMode != currentBlend) {
                g_meshBatches.emplace_back();
                currentBatch = &g_meshBatches.back();
                currentBatch->textureId = texId;
                currentBatch->blendMode = blendMode;
                currentTexture = texId;
                currentBlend = blendMode;
            }

            int worldVerticesLength = SUPER(mesh)->worldVerticesLength;
            int vertexCount = worldVerticesLength / 2;
            g_worldVertices.resize(worldVerticesLength);
            spVertexAttachment_computeWorldVertices(SUPER(mesh), slot, 0,
                worldVerticesLength, g_worldVertices.data(), 0, 2);

            float* uvs = mesh->uvs;
            spColor& attachColor = mesh->color;

            float r = skelColor.r * slotColor.r * attachColor.r;
            float g = skelColor.g * slotColor.g * attachColor.g;
            float b = skelColor.b * slotColor.b * attachColor.b;
            float a = skelColor.a * slotColor.a * attachColor.a;

            auto baseIndex = static_cast<uint16_t>(
                currentBatch->vertices.size() / 8);

            for (int j = 0; j < vertexCount; ++j) {
                currentBatch->vertices.push_back(g_worldVertices[j * 2]);
                currentBatch->vertices.push_back(g_worldVertices[j * 2 + 1]);
                currentBatch->vertices.push_back(uvs[j * 2]);
                currentBatch->vertices.push_back(uvs[j * 2 + 1]);
                currentBatch->vertices.push_back(r);
                currentBatch->vertices.push_back(g);
                currentBatch->vertices.push_back(b);
                currentBatch->vertices.push_back(a);
            }

            for (int j = 0; j < mesh->trianglesCount; ++j) {
                currentBatch->indices.push_back(
                    static_cast<uint16_t>(baseIndex + mesh->triangles[j]));
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchCount(int instanceId) {
    extractMeshBatches(instanceId);
    return static_cast<int>(g_meshBatches.size());
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchVertexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_meshBatches.size())) return 0;
    return static_cast<int>(g_meshBatches[batchIndex].vertices.size() / 8);
}

EMSCRIPTEN_KEEPALIVE
int spine_getMeshBatchIndexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_meshBatches.size())) return 0;
    return static_cast<int>(g_meshBatches[batchIndex].indices.size());
}

EMSCRIPTEN_KEEPALIVE
void spine_getMeshBatchData(int instanceId, int batchIndex,
                             uintptr_t outVerticesPtr, uintptr_t outIndicesPtr,
                             uintptr_t outTextureIdPtr, uintptr_t outBlendModePtr) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_meshBatches.size())) return;

    auto& batch = g_meshBatches[batchIndex];

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

} // extern "C"

int main() {
    return 0;
}
