/**
 * @file    SpineModuleEntry.cpp
 * @brief   Standalone Spine WASM module entry point
 *
 * Pure computation module (no GL dependencies).
 * Handles: skeleton loading, animation update, mesh extraction.
 * Core WASM handles all rendering via renderer_submitTriangles.
 */

#include <emscripten.h>
#include <emscripten/bind.h>

#include <spine/spine.h>
#include <spine/Extension.h>
#include <spine/Atlas.h>
#include <spine/RegionAttachment.h>
#include <spine/MeshAttachment.h>
#include <spine/ClippingAttachment.h>

#include <unordered_map>
#include <vector>
#include <string>
#include <cstring>
#include <cstdint>

// =============================================================================
// Spine Extension (file I/O via Emscripten FS)
// =============================================================================

class SpineModuleExtension : public spine::DefaultSpineExtension {
protected:
    char* _readFile(const spine::String& path, int* length) override {
        FILE* file = fopen(path.buffer(), "rb");
        if (!file) {
            *length = 0;
            return nullptr;
        }
        fseek(file, 0, SEEK_END);
        *length = static_cast<int>(ftell(file));
        fseek(file, 0, SEEK_SET);

        char* data = SpineExtension::alloc<char>(*length, __FILE__, __LINE__);
        fread(data, 1, *length, file);
        fclose(file);
        return data;
    }
};

static SpineModuleExtension* g_extension = nullptr;

static void ensureExtension() {
    if (!g_extension) {
        g_extension = new SpineModuleExtension();
        spine::SpineExtension::setInstance(g_extension);
    }
}

namespace spine {
SpineExtension* getDefaultExtension() {
    if (!g_extension) {
        g_extension = new SpineModuleExtension();
    }
    return g_extension;
}
}

// =============================================================================
// Texture Loader (deferred — JS provides texture IDs)
// =============================================================================

class DeferredTextureLoader : public spine::TextureLoader {
public:
    void load(spine::AtlasPage& page, const spine::String& path) override {
        page.texturePath = path;
    }

    void unload(void*) override {}
};

#ifdef ES_SPINE_38
static uint32_t getTextureId(spine::RegionAttachment* attachment) {
    auto* atlasRegion = static_cast<spine::AtlasRegion*>(attachment->getRendererObject());
    if (!atlasRegion || !atlasRegion->page) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(atlasRegion->page->getRendererObject()));
}

static uint32_t getTextureId(spine::MeshAttachment* attachment) {
    auto* atlasRegion = static_cast<spine::AtlasRegion*>(attachment->getRendererObject());
    if (!atlasRegion || !atlasRegion->page) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(atlasRegion->page->getRendererObject()));
}
#else
static uint32_t getTextureId(spine::RegionAttachment* attachment) {
    auto* region = attachment->getRegion();
    if (!region) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(region->rendererObject));
}

static uint32_t getTextureId(spine::MeshAttachment* attachment) {
    auto* region = attachment->getRegion();
    if (!region) return 0;
    return static_cast<uint32_t>(
        reinterpret_cast<uintptr_t>(region->rendererObject));
}
#endif

// =============================================================================
// Data Structures
// =============================================================================

struct SkeletonHandle {
    std::unique_ptr<spine::Atlas> atlas;
    std::unique_ptr<spine::SkeletonData> skeletonData;
    std::unique_ptr<spine::AnimationStateData> stateData;
    DeferredTextureLoader textureLoader;
};

struct SpineInstance {
    std::unique_ptr<spine::Skeleton> skeleton;
    std::unique_ptr<spine::AnimationState> state;
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

// =============================================================================
// Resource Management
// =============================================================================

int spine_loadSkeleton(const std::string& skelPath, const std::string& atlasText,
                       int atlasLen, bool isBinary) {
    ensureExtension();

    auto& handle = g_skeletons[g_nextSkeletonId];

    handle.atlas = std::make_unique<spine::Atlas>(
        atlasText.c_str(), atlasLen, "", &handle.textureLoader, true);

    if (handle.atlas->getPages().size() == 0) {
        g_skeletons.erase(g_nextSkeletonId);
        return -1;
    }

    if (isBinary) {
        spine::SkeletonBinary binary(handle.atlas.get());
        binary.setScale(1.0f);
        handle.skeletonData.reset(binary.readSkeletonDataFile(spine::String(skelPath.c_str())));
    } else {
        spine::SkeletonJson json(handle.atlas.get());
        json.setScale(1.0f);
        handle.skeletonData.reset(json.readSkeletonDataFile(spine::String(skelPath.c_str())));
    }

    if (!handle.skeletonData) {
        g_skeletons.erase(g_nextSkeletonId);
        return -1;
    }

    handle.stateData = std::make_unique<spine::AnimationStateData>(handle.skeletonData.get());
    handle.stateData->setDefaultMix(0.2f);

    return g_nextSkeletonId++;
}

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
        g_instances.erase(id);
    }

    g_skeletons.erase(it);
}

int spine_getAtlasPageCount(int handle) {
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return 0;
    return static_cast<int>(it->second.atlas->getPages().size());
}

std::string spine_getAtlasPageTextureName(int handle, int pageIndex) {
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return "";
    auto& pages = it->second.atlas->getPages();
    if (pageIndex < 0 || pageIndex >= static_cast<int>(pages.size())) return "";
    return std::string(pages[pageIndex]->texturePath.buffer());
}

void spine_setAtlasPageTexture(int handle, int pageIndex,
                                uint32_t textureId, int width, int height) {
    auto it = g_skeletons.find(handle);
    if (it == g_skeletons.end()) return;
    auto& pages = it->second.atlas->getPages();
    if (pageIndex < 0 || pageIndex >= static_cast<int>(pages.size())) return;

    auto* page = pages[pageIndex];
    void* texPtr = reinterpret_cast<void*>(static_cast<uintptr_t>(textureId));
#ifdef ES_SPINE_38
    page->setRendererObject(texPtr);
#else
    page->texture = texPtr;
    auto& regions = it->second.atlas->getRegions();
    for (size_t i = 0; i < regions.size(); ++i) {
        if (regions[i]->page == page) {
            regions[i]->rendererObject = texPtr;
        }
    }
#endif
    page->width = width;
    page->height = height;
}

// =============================================================================
// Instance Management
// =============================================================================

int spine_createInstance(int skeletonHandle) {
    auto it = g_skeletons.find(skeletonHandle);
    if (it == g_skeletons.end()) return -1;

    auto& skelData = it->second;
    auto& inst = g_instances[g_nextInstanceId];
    inst.skeletonHandle = skeletonHandle;
    inst.skeleton = std::make_unique<spine::Skeleton>(skelData.skeletonData.get());
    inst.state = std::make_unique<spine::AnimationState>(skelData.stateData.get());
    inst.skeleton->setToSetupPose();
#ifdef ES_SPINE_38
    inst.skeleton->updateWorldTransform();
#else
    inst.skeleton->updateWorldTransform(spine::Physics_Update);
#endif

    return g_nextInstanceId++;
}

void spine_destroyInstance(int instanceId) {
    g_instances.erase(instanceId);
}

// =============================================================================
// Animation Control
// =============================================================================

bool spine_playAnimation(int instanceId, const std::string& name, bool loop, int track) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return false;

    auto* anim = it->second.skeleton->getData()->findAnimation(spine::String(name.c_str()));
    if (!anim) return false;

    it->second.state->setAnimation(track, anim, loop);
    return true;
}

bool spine_addAnimation(int instanceId, const std::string& name,
                         bool loop, float delay, int track) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return false;

    auto* anim = it->second.skeleton->getData()->findAnimation(spine::String(name.c_str()));
    if (!anim) return false;

    it->second.state->addAnimation(track, anim, loop, delay);
    return true;
}

void spine_setSkin(int instanceId, const std::string& name) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;

    if (name.empty()) {
        it->second.skeleton->setSkin(nullptr);
    } else {
        it->second.skeleton->setSkin(spine::String(name.c_str()));
    }
    it->second.skeleton->setSlotsToSetupPose();
}

void spine_update(int instanceId, float dt) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;

    it->second.state->update(dt);
    it->second.state->apply(*it->second.skeleton);
#ifdef ES_SPINE_38
    it->second.skeleton->updateWorldTransform();
#else
    it->second.skeleton->update(dt);
    it->second.skeleton->updateWorldTransform(spine::Physics_Update);
#endif
}

// =============================================================================
// Query
// =============================================================================

std::string spine_getAnimations(int instanceId) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return "[]";

    auto& anims = it->second.skeleton->getData()->getAnimations();
    std::string result = "[";
    for (size_t i = 0; i < anims.size(); ++i) {
        if (i > 0) result += ",";
        result += "\"";
        result += anims[i]->getName().buffer();
        result += "\"";
    }
    result += "]";
    return result;
}

std::string spine_getSkins(int instanceId) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return "[]";

    auto& skins = it->second.skeleton->getData()->getSkins();
    std::string result = "[";
    for (size_t i = 0; i < skins.size(); ++i) {
        if (i > 0) result += ",";
        result += "\"";
        result += skins[i]->getName().buffer();
        result += "\"";
    }
    result += "]";
    return result;
}

bool spine_getBonePosition(int instanceId, const std::string& bone,
                            uintptr_t outXPtr, uintptr_t outYPtr) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return false;

    auto* b = it->second.skeleton->findBone(spine::String(bone.c_str()));
    if (!b) return false;

    *reinterpret_cast<float*>(outXPtr) = b->getWorldX();
    *reinterpret_cast<float*>(outYPtr) = b->getWorldY();
    return true;
}

float spine_getBoneRotation(int instanceId, const std::string& bone) {
    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return 0.0f;

    auto* b = it->second.skeleton->findBone(spine::String(bone.c_str()));
    if (!b) return 0.0f;

    return b->getWorldRotationX();
}

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

    spine::Vector<float> verts;
    it->second.skeleton->getBounds(*outX, *outY, *outW, *outH, verts);
}

// =============================================================================
// Mesh Extraction
// =============================================================================

static void extractMeshBatches(int instanceId) {
    g_meshBatches.clear();

    auto it = g_instances.find(instanceId);
    if (it == g_instances.end()) return;

    auto* skeleton = it->second.skeleton.get();
    auto& drawOrder = skeleton->getDrawOrder();
    auto& skelColor = skeleton->getColor();

    MeshBatch* currentBatch = nullptr;
    uint32_t currentTexture = 0;
    int currentBlend = 0;

    for (size_t i = 0; i < drawOrder.size(); ++i) {
        auto* slot = drawOrder[i];
        if (!slot) continue;

        auto* attachment = slot->getAttachment();
        if (!attachment) continue;
#ifndef ES_SPINE_38
        if (!slot->getData().isVisible()) continue;
#endif

        if (attachment->getRTTI().isExactly(spine::ClippingAttachment::rtti)) {
            continue;
        }

        auto& slotColor = slot->getColor();

        int blendMode = 0;
        switch (slot->getData().getBlendMode()) {
            case spine::BlendMode_Normal: blendMode = 0; break;
            case spine::BlendMode_Additive: blendMode = 1; break;
            case spine::BlendMode_Multiply: blendMode = 2; break;
            case spine::BlendMode_Screen: blendMode = 3; break;
        }

        if (attachment->getRTTI().isExactly(spine::RegionAttachment::rtti)) {
            auto* region = static_cast<spine::RegionAttachment*>(attachment);

            uint32_t texId = getTextureId(region);
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
            region->computeWorldVertices(slot->getBone(), g_worldVertices.data(), 0, 2);
#else
            region->computeWorldVertices(*slot, g_worldVertices.data(), 0, 2);
#endif

            auto& uvs = region->getUVs();
            auto& attachColor = region->getColor();

            float r = skelColor.r * slotColor.r * attachColor.r;
            float g = skelColor.g * slotColor.g * attachColor.g;
            float b = skelColor.b * slotColor.b * attachColor.b;
            float a = skelColor.a * slotColor.a * attachColor.a;

            auto baseIndex = static_cast<uint16_t>(
                currentBatch->vertices.size() / 8);

            for (size_t j = 0; j < 4; ++j) {
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

        } else if (attachment->getRTTI().isExactly(spine::MeshAttachment::rtti)) {
            auto* mesh = static_cast<spine::MeshAttachment*>(attachment);

            uint32_t texId = getTextureId(mesh);
            if (!texId) continue;

            if (!currentBatch || texId != currentTexture || blendMode != currentBlend) {
                g_meshBatches.emplace_back();
                currentBatch = &g_meshBatches.back();
                currentBatch->textureId = texId;
                currentBatch->blendMode = blendMode;
                currentTexture = texId;
                currentBlend = blendMode;
            }

            size_t vertexCount = mesh->getWorldVerticesLength() / 2;
            g_worldVertices.resize(mesh->getWorldVerticesLength());
            mesh->computeWorldVertices(*slot, 0, mesh->getWorldVerticesLength(),
                                       g_worldVertices.data(), 0, 2);

            auto& uvs = mesh->getUVs();
            auto& triangles = mesh->getTriangles();
            auto& attachColor = mesh->getColor();

            float r = skelColor.r * slotColor.r * attachColor.r;
            float g = skelColor.g * slotColor.g * attachColor.g;
            float b = skelColor.b * slotColor.b * attachColor.b;
            float a = skelColor.a * slotColor.a * attachColor.a;

            auto baseIndex = static_cast<uint16_t>(
                currentBatch->vertices.size() / 8);

            for (size_t j = 0; j < vertexCount; ++j) {
                currentBatch->vertices.push_back(g_worldVertices[j * 2]);
                currentBatch->vertices.push_back(g_worldVertices[j * 2 + 1]);
                currentBatch->vertices.push_back(uvs[j * 2]);
                currentBatch->vertices.push_back(uvs[j * 2 + 1]);
                currentBatch->vertices.push_back(r);
                currentBatch->vertices.push_back(g);
                currentBatch->vertices.push_back(b);
                currentBatch->vertices.push_back(a);
            }

            for (size_t j = 0; j < triangles.size(); ++j) {
                currentBatch->indices.push_back(
                    static_cast<uint16_t>(baseIndex + triangles[j]));
            }
        }
    }
}

int spine_getMeshBatchCount(int instanceId) {
    extractMeshBatches(instanceId);
    return static_cast<int>(g_meshBatches.size());
}

int spine_getMeshBatchVertexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_meshBatches.size())) return 0;
    return static_cast<int>(g_meshBatches[batchIndex].vertices.size() / 8);
}

int spine_getMeshBatchIndexCount(int instanceId, int batchIndex) {
    (void)instanceId;
    if (batchIndex < 0 || batchIndex >= static_cast<int>(g_meshBatches.size())) return 0;
    return static_cast<int>(g_meshBatches[batchIndex].indices.size());
}

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

// =============================================================================
// Emscripten Bindings
// =============================================================================

EMSCRIPTEN_BINDINGS(spine_module) {
    emscripten::function("spine_loadSkeleton", &spine_loadSkeleton);
    emscripten::function("spine_unloadSkeleton", &spine_unloadSkeleton);
    emscripten::function("spine_getAtlasPageCount", &spine_getAtlasPageCount);
    emscripten::function("spine_getAtlasPageTextureName", &spine_getAtlasPageTextureName);
    emscripten::function("spine_setAtlasPageTexture", &spine_setAtlasPageTexture);

    emscripten::function("spine_createInstance", &spine_createInstance);
    emscripten::function("spine_destroyInstance", &spine_destroyInstance);

    emscripten::function("spine_playAnimation", &spine_playAnimation);
    emscripten::function("spine_addAnimation", &spine_addAnimation);
    emscripten::function("spine_setSkin", &spine_setSkin);
    emscripten::function("spine_update", &spine_update);

    emscripten::function("spine_getAnimations", &spine_getAnimations);
    emscripten::function("spine_getSkins", &spine_getSkins);
    emscripten::function("spine_getBonePosition", &spine_getBonePosition);
    emscripten::function("spine_getBoneRotation", &spine_getBoneRotation);
    emscripten::function("spine_getBounds", &spine_getBounds);

    emscripten::function("spine_getMeshBatchCount", &spine_getMeshBatchCount);
    emscripten::function("spine_getMeshBatchVertexCount", &spine_getMeshBatchVertexCount);
    emscripten::function("spine_getMeshBatchIndexCount", &spine_getMeshBatchIndexCount);
    emscripten::function("spine_getMeshBatchData", &spine_getMeshBatchData);
}

int main() {
    return 0;
}
