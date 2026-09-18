// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GfxDevice.cpp
 * @brief   The device's record of its objects, and recovery as one transaction over it.
 */

#include "./GfxDevice.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <cstring>
#include <utility>

namespace esengine {

namespace {

bool isDepthFormat(GfxPixelFormat format) {
    return format == GfxPixelFormat::DepthComponent24 || format == GfxPixelFormat::Depth24Stencil8;
}

/**
 * Writes a block of pixels into an image kept as it would be uploaded without a
 * flip, so replaying the image never needs one. A flipped block lands its first
 * row at the top of its rectangle, which is what the upload flag means on both backends.
 */
void patchImage(std::vector<u8>& image, u32 imageWidth, u32 imageHeight, u32 bpp,
                i32 x, i32 y, u32 width, u32 height, const u8* pixels, bool flipY) {
    if (x < 0 || y < 0 || static_cast<u32>(x) + width > imageWidth
        || static_cast<u32>(y) + height > imageHeight) {
        return;
    }
    const usize rowBytes = static_cast<usize>(width) * bpp;
    for (u32 row = 0; row < height; ++row) {
        const u32 source = flipY ? height - 1 - row : row;
        std::memcpy(&image[(static_cast<usize>(y) + row) * imageWidth * bpp + static_cast<usize>(x) * bpp],
                    pixels + static_cast<usize>(source) * rowBytes, rowBytes);
    }
}

std::vector<u8> uploadOrderImage(const TextureDesc& desc, const void* pixels) {
    const u32 bpp = gfxBytesPerPixel(desc.format);
    std::vector<u8> image(static_cast<usize>(desc.width) * desc.height * bpp, 0);
    if (pixels) {
        patchImage(image, desc.width, desc.height, bpp, 0, 0, desc.width, desc.height,
                   static_cast<const u8*>(pixels), desc.flipY);
    }
    return image;
}

}  // namespace

// =============================================================================
// Loss and recovery
// =============================================================================

bool GfxDevice::markDeviceLost(GfxDeviceLostReason reason, std::string message, std::string context) {
    if (device_status_ != GfxDeviceStatus::Live && device_status_ != GfxDeviceStatus::Recovering) {
        return false;
    }
    device_status_ = GfxDeviceStatus::Lost;
    device_info_.reason = reason;
    device_info_.identity = identity_;
    device_info_.message = std::move(message);
    device_info_.context = std::move(context);
    device_info_.frame = device_frame_;
    onDeviceLost();

    // Every object is rebuilt by the next recovery, owed or not.
    for (auto& [id, record] : registry_.buffers.all()) { record.realized = false; record.owed = false; }
    for (auto& [id, record] : registry_.textures.all()) { record.realized = false; record.owed = false; }
    for (auto& [id, record] : registry_.programs.all()) record.realized = false;
    for (auto& [id, record] : registry_.framebuffers.all()) record.realized = false;
    for (auto& [id, record] : registry_.timerQueries.all()) record.realized = false;
    owed_count_ = 0;
    native_locations_.clear();
    current_pipeline_ = PipelineHandle::Invalid;

    if (device_lost_handler_) device_lost_handler_(device_info_);
    return true;
}

bool GfxDevice::recoverDevice() {
    if (device_status_ == GfxDeviceStatus::Live || device_status_ == GfxDeviceStatus::Recovering) {
        return true;
    }
    if (device_status_ == GfxDeviceStatus::Dead) return false;

    device_status_ = GfxDeviceStatus::Recovering;
    if (!recreateDevice()) {
        device_status_ = GfxDeviceStatus::Lost;
        return false;
    }
    ++device_generation_;
    realizeRegistry();
    if (device_status_ != GfxDeviceStatus::Recovering) return isDeviceUsable();
    settleRecovery();
    return true;
}

void GfxDevice::realizeRegistry() {
    for (auto& [id, record] : registry_.programs.all()) {
        std::vector<GfxAttribBinding> bindings;
        bindings.reserve(record.attribBindings.size());
        for (const auto& [index, name] : record.attribBindings) bindings.push_back({index, name.c_str()});
        const GfxShaderSource source{record.language, record.vertex.c_str(), record.fragment.c_str()};
        std::string log;
        GfxShaderStage stage = GfxShaderStage::None;
        record.realized = backendCreateProgram(id, source, bindings.data(),
                                               static_cast<u32>(bindings.size()), &log, &stage);
        if (record.realized) {
            realizeProgramState(id, record);
        } else {
            ES_LOG_ERROR("Device recovery: program {} did not rebuild: {}", id, log);
        }
    }

    for (auto& [id, record] : registry_.buffers.all()) {
        const bool hasBytes = !record.bytes.empty();
        record.realized = backendCreateBuffer(id, record.desc, hasBytes ? record.bytes.data() : nullptr);
        record.owed = record.realized && !hasBytes && record.content.kind() == GfxContentKind::Sourced;
        if (record.owed) ++owed_count_;
        if (record.content.kind() != GfxContentKind::Retained) dropBytes(record.bytes);
    }

    for (auto& [id, record] : registry_.textures.all()) {
        const bool hasBytes = !record.bytes.empty();
        if (record.compressed && hasBytes) {
            record.realized = backendCreateCompressedTexture(
                id, record.desc, record.compressedFormat, record.bytes.data(),
                static_cast<u32>(record.bytes.size()), record.mipLevels);
        } else {
            TextureDesc desc = record.desc;
            desc.flipY = false;
            if (record.compressed) desc.format = GfxPixelFormat::RGBA8;
            record.realized = backendCreateTexture(id, desc, hasBytes ? record.bytes.data() : nullptr);
        }
        record.owed = record.realized && !hasBytes && record.content.kind() == GfxContentKind::Sourced;
        if (record.owed) ++owed_count_;
        if (record.content.kind() != GfxContentKind::Retained) dropBytes(record.bytes);
        if (!record.realized) ES_LOG_ERROR("Device recovery: texture {} did not rebuild", id);
    }

    for (auto& [id, record] : registry_.framebuffers.all()) {
        record.realized = backendCreateFramebuffer(id, record.desc);
    }
    for (auto& [id, record] : registry_.timerQueries.all()) {
        record.realized = backendCreateTimerQuery(id);
    }
}

void GfxDevice::realizeProgramState(u32 id, GfxProgramRecord& record) {
    const bool anyValue = std::any_of(record.uniformValues.begin(), record.uniformValues.end(),
                                      [](const GfxUniformValue& v) { return v.type != GfxUniformValue::Type::None; });
    if (anyValue) {
        backendUseProgram(id);
        for (usize i = 0; i < record.uniformValues.size(); ++i) {
            if (record.uniformValues[i].type == GfxUniformValue::Type::None) continue;
            const i32 native = nativeUniformLocation(record, id, static_cast<i32>(i));
            if (native >= 0) backendSetUniform(native, record.uniformValues[i]);
        }
    }
    for (usize i = 0; i < record.blockNames.size(); ++i) {
        if (record.blockBindings[i] == GFX_UNBOUND_BLOCK) continue;
        const u32 native = backendUniformBlockIndex(id, record.blockNames[i].c_str());
        if (native != GFX_INVALID_UNIFORM_BLOCK) {
            backendUniformBlockBinding(id, native, record.blockBindings[i]);
        }
    }
}

void GfxDevice::settleRecovery() {
    if (device_status_ != GfxDeviceStatus::Recovering || owed_count_ != 0) return;
    device_status_ = GfxDeviceStatus::Live;
    device_info_ = GfxDeviceLostInfo{};
    captureDeviceIdentity();
}

void GfxDevice::payTexture(u32 id, GfxTextureRecord& record) {
    if (!record.owed) return;
    record.owed = false;
    --owed_count_;
    if (record.desc.mipmaps && record.realized) backendGenerateMipmaps(id);
    settleRecovery();
}

void GfxDevice::forgoContent(const GfxOwedContent& owed) {
    if (owed.kind == GfxOwedContent::Kind::Buffer) {
        if (auto* record = registry_.buffers.find(owed.id); record && record->owed) {
            record->owed = false;
            --owed_count_;
        }
    } else if (auto* record = registry_.textures.find(owed.id); record && record->owed) {
        record->owed = false;
        --owed_count_;
    }
    settleRecovery();
}

void GfxDevice::restoreContent(const GfxOwedContent& owed) {
    if (owed.kind == GfxOwedContent::Kind::Texture) {
        if (auto* record = registry_.textures.find(owed.id); record && record->owed) {
            payTexture(owed.id, *record);
        }
        return;
    }
    forgoContent(owed);
}

// =============================================================================
// Kept bytes
// =============================================================================

void GfxDevice::keepBytes(std::vector<u8>& slot, std::vector<u8> bytes) {
    retained_bytes_ -= slot.size();
    retained_bytes_ += bytes.size();
    const usize grownBy = bytes.size() > slot.size() ? bytes.size() - slot.size() : 0;
    slot = std::move(bytes);
    judgeRetainedBudget(grownBy);
}

void GfxDevice::dropBytes(std::vector<u8>& slot) {
    retained_bytes_ -= slot.size();
    slot = {};
    judgeRetainedBudget(0);
}

std::vector<u8> GfxDevice::takeBytes(std::vector<u8>& slot) {
    retained_bytes_ -= slot.size();
    judgeRetainedBudget(0);
    return std::exchange(slot, {});
}

void GfxDevice::judgeRetainedBudget(usize grownBy) {
    if (retained_budget_ == 0 || retained_bytes_ <= retained_budget_) {
        over_retained_budget_ = false;
        return;
    }
    if (over_retained_budget_ || grownBy == 0) return;
    over_retained_budget_ = true;
    constexpr f64 MiB = 1024.0 * 1024.0;
    ES_LOG_WARN("The graphics device keeps {:.2f} MiB of CPU copies to restore content after a GPU loss, "
                "past its {:.2f} MiB budget (the last copy was {} bytes). Content that can be loaded "
                "or drawn again should say who refills it instead of being retained.",
                static_cast<f64>(retained_bytes_) / MiB, static_cast<f64>(retained_budget_) / MiB, grownBy);
}

void GfxDevice::eraseBuffer(u32 id) {
    if (auto* record = registry_.buffers.find(id)) dropBytes(record->bytes);
    registry_.buffers.erase(id);
}

void GfxDevice::eraseTexture(u32 id) {
    if (auto* record = registry_.textures.find(id)) dropBytes(record->bytes);
    registry_.textures.erase(id);
}

// =============================================================================
// Buffers
// =============================================================================

BufferHandle GfxDevice::createBuffer(const BufferDesc& desc, GfxContent content, const void* initialData) {
    if (device_status_ == GfxDeviceStatus::Dead) return BufferHandle::Invalid;
    const bool usable = isDeviceUsable();
    GfxBufferRecord record{desc, content};
    if (content.kind() == GfxContentKind::Retained || (!usable && initialData)) {
        std::vector<u8> bytes(desc.size, 0);
        if (initialData && desc.size > 0) std::memcpy(bytes.data(), initialData, desc.size);
        keepBytes(record.bytes, std::move(bytes));
    }
    const u32 id = registry_.buffers.insert(std::move(record));
    if (!usable) return BufferHandle{id};
    if (!backendCreateBuffer(id, desc, initialData)) {
        eraseBuffer(id);
        return BufferHandle::Invalid;
    }
    registry_.buffers.find(id)->realized = true;
    return BufferHandle{id};
}

void GfxDevice::deleteBuffer(BufferHandle buffer) {
    const u32 id = static_cast<u32>(buffer);
    auto* record = registry_.buffers.find(id);
    if (!record) return;
    if (record->realized) backendDeleteBuffer(id);
    if (record->owed) --owed_count_;
    eraseBuffer(id);
    settleRecovery();
}

void GfxDevice::updateBuffer(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes) {
    const u32 id = static_cast<u32>(buffer);
    auto* record = registry_.buffers.find(id);
    if (!record || !data || sizeBytes == 0) return;
    const bool whole = offsetBytes == 0 && sizeBytes >= record->desc.size;
    if (!record->bytes.empty() && static_cast<usize>(offsetBytes) + sizeBytes <= record->bytes.size()) {
        std::memcpy(record->bytes.data() + offsetBytes, data, sizeBytes);
    } else if (!record->realized && whole) {
        const auto* first = static_cast<const u8*>(data);
        keepBytes(record->bytes, std::vector<u8>(first, first + record->desc.size));
    }
    if (record->realized) backendUpdateBuffer(id, offsetBytes, data, sizeBytes);
    if (record->owed && whole) {
        record->owed = false;
        --owed_count_;
        settleRecovery();
    }
}

void GfxDevice::resizeBuffer(BufferHandle buffer, u32 sizeBytes, const void* data) {
    const u32 id = static_cast<u32>(buffer);
    auto* record = registry_.buffers.find(id);
    if (!record) return;
    record->desc.size = sizeBytes;
    if (record->content.kind() == GfxContentKind::Retained || (!record->realized && data)) {
        std::vector<u8> bytes(sizeBytes, 0);
        if (data && sizeBytes > 0) std::memcpy(bytes.data(), data, sizeBytes);
        keepBytes(record->bytes, std::move(bytes));
    } else {
        dropBytes(record->bytes);
    }
    if (record->realized) backendResizeBuffer(id, record->desc, data);
    if (record->owed && data) {
        record->owed = false;
        --owed_count_;
        settleRecovery();
    }
}

const BufferDesc* GfxDevice::bufferDesc(BufferHandle buffer) const {
    const auto* record = registry_.buffers.find(static_cast<u32>(buffer));
    return record ? &record->desc : nullptr;
}

// =============================================================================
// Vertex layouts and pipelines
// =============================================================================

VertexLayoutHandle GfxDevice::createVertexLayout(const VertexLayoutDesc& desc) {
    if (device_status_ == GfxDeviceStatus::Dead || !backendAcceptsVertexLayout(desc)) {
        return VertexLayoutHandle::Invalid;
    }
    return VertexLayoutHandle{registry_.layouts.insert(GfxLayoutRecord{desc})};
}

void GfxDevice::deleteVertexLayout(VertexLayoutHandle layout) {
    const u32 id = static_cast<u32>(layout);
    if (!registry_.layouts.find(id)) return;
    backendDeleteVertexLayout(id);
    registry_.layouts.erase(id);
}

const VertexLayoutDesc* GfxDevice::vertexLayoutDesc(VertexLayoutHandle layout) const {
    const auto* record = registry_.layouts.find(static_cast<u32>(layout));
    return record ? &record->desc : nullptr;
}

PipelineHandle GfxDevice::createPipeline(const PipelineDesc& desc) {
    if (device_status_ == GfxDeviceStatus::Dead) return PipelineHandle::Invalid;
    if (const u32 existing = registry_.findPipeline(desc)) return PipelineHandle{existing};
    return PipelineHandle{registry_.pipelines.insert(GfxPipelineRecord{desc})};
}

const PipelineDesc* GfxDevice::pipelineDesc(PipelineHandle handle) const {
    const auto* record = registry_.pipelines.find(static_cast<u32>(handle));
    return record ? &record->desc : nullptr;
}

void GfxDevice::setPipeline(PipelineHandle handle) {
    if (handle == PipelineHandle::Invalid) return;
    const auto* record = registry_.pipelines.find(static_cast<u32>(handle));
    if (!record) return;
    current_pipeline_ = handle;
    current_program_ = record->desc.program;
    backendSetPipeline(static_cast<u32>(handle), record->desc);
}

void GfxDevice::invalidatePipelineCache() {
    current_pipeline_ = PipelineHandle::Invalid;
    backendInvalidatePipelineCache();
}

// =============================================================================
// Textures
// =============================================================================

TextureHandle GfxDevice::createTexture(const TextureDesc& desc, GfxContent content, const void* pixels) {
    if (device_status_ == GfxDeviceStatus::Dead) return TextureHandle::Invalid;
    const bool usable = isDeviceUsable();
    GfxTextureRecord record{desc, content};
    if (content.kind() == GfxContentKind::Retained && (desc.samples > 1 || isDepthFormat(desc.format))) {
        ES_LOG_ERROR("GfxDevice::createTexture: an attachment-only texture cannot keep its contents");
    } else if (content.kind() == GfxContentKind::Retained || (!usable && pixels)) {
        keepBytes(record.bytes, uploadOrderImage(desc, pixels));
        record.desc.flipY = false;
    }
    const u32 id = registry_.textures.insert(std::move(record));
    if (!usable) return TextureHandle{id};
    if (!backendCreateTexture(id, desc, pixels)) {
        eraseTexture(id);
        return TextureHandle::Invalid;
    }
    registry_.textures.find(id)->realized = true;
    return TextureHandle{id};
}

TextureHandle GfxDevice::createCompressedTexture(const TextureDesc& desc, GfxContent content,
                                                 GfxCompressedFormat format, const void* data,
                                                 u32 byteLength, u32 mipLevels) {
    if (device_status_ == GfxDeviceStatus::Dead) return TextureHandle::Invalid;
    const bool usable = isDeviceUsable();
    GfxTextureRecord record{desc, content};
    record.compressed = true;
    record.compressedFormat = format;
    record.mipLevels = mipLevels ? mipLevels : 1;
    if (data && (content.kind() == GfxContentKind::Retained || !usable)) {
        const auto* first = static_cast<const u8*>(data);
        keepBytes(record.bytes, std::vector<u8>(first, first + byteLength));
    }
    const u32 id = registry_.textures.insert(std::move(record));
    if (!usable) return TextureHandle{id};
    if (!backendCreateCompressedTexture(id, desc, format, data, byteLength, mipLevels)) {
        eraseTexture(id);
        return TextureHandle::Invalid;
    }
    registry_.textures.find(id)->realized = true;
    return TextureHandle{id};
}

bool GfxDevice::restoreCompressedTexture(TextureHandle texture, GfxCompressedFormat format,
                                         const void* data, u32 byteLength, u32 mipLevels) {
    const u32 id = static_cast<u32>(texture);
    auto* record = registry_.textures.find(id);
    if (!record || !isDeviceUsable()) return false;
    if (record->realized) backendDeleteTexture(id);
    record->compressed = true;
    record->compressedFormat = format;
    record->mipLevels = mipLevels ? mipLevels : 1;
    if (record->content.kind() == GfxContentKind::Retained) {
        const auto* first = static_cast<const u8*>(data);
        keepBytes(record->bytes, std::vector<u8>(first, first + byteLength));
    }
    record->realized = backendCreateCompressedTexture(id, record->desc, format, data, byteLength, mipLevels);
    if (record->realized) payTexture(id, *record);
    return record->realized;
}

TextureHandle GfxDevice::importExternalTexture(u32 nativeId, const TextureDesc& desc, GfxContent content) {
    if (device_status_ == GfxDeviceStatus::Dead) return TextureHandle::Invalid;
    if (content.kind() == GfxContentKind::Retained) {
        ES_LOG_ERROR("GfxDevice::importExternalTexture: the device never saw these pixels to keep them");
        return TextureHandle::Invalid;
    }
    const u32 id = registry_.textures.insert(GfxTextureRecord{desc, content});
    if (!isDeviceUsable()) return TextureHandle{id};
    if (!backendAdoptTexture(id, nativeId, desc)) {
        eraseTexture(id);
        return TextureHandle::Invalid;
    }
    registry_.textures.find(id)->realized = true;
    return TextureHandle{id};
}

bool GfxDevice::restoreTextureFromNative(TextureHandle texture, u32 nativeId) {
    const u32 id = static_cast<u32>(texture);
    auto* record = registry_.textures.find(id);
    if (!record || !isDeviceUsable()) return false;
    if (record->realized) backendDeleteTexture(id);
    record->realized = backendAdoptTexture(id, nativeId, record->desc);
    if (record->realized) payTexture(id, *record);
    return record->realized;
}

bool GfxDevice::adoptTextureContent(TextureHandle into, TextureHandle from) {
    const u32 intoId = static_cast<u32>(into);
    const u32 fromId = static_cast<u32>(from);
    auto* target = registry_.textures.find(intoId);
    auto* source = registry_.textures.find(fromId);
    if (!target || !source || intoId == fromId || !source->realized) return false;
    if (target->content.kind() == GfxContentKind::Retained && source->bytes.empty()) {
        ES_LOG_ERROR("GfxDevice::adoptTextureContent: texture {} keeps its bytes and {} has none to give",
                     intoId, fromId);
        return false;
    }
    if (target->realized) backendDeleteTexture(intoId);
    backendMoveTexture(intoId, fromId);

    target->desc = source->desc;
    target->compressed = source->compressed;
    target->compressedFormat = source->compressedFormat;
    target->mipLevels = source->mipLevels;
    target->realized = true;
    std::vector<u8> sourceBytes = takeBytes(source->bytes);
    if (target->content.kind() == GfxContentKind::Retained) {
        keepBytes(target->bytes, std::move(sourceBytes));
    } else {
        dropBytes(target->bytes);
    }
    if (source->owed) --owed_count_;
    const bool owed = target->owed;
    eraseTexture(fromId);
    if (owed) {
        target->owed = false;
        --owed_count_;
    }
    settleRecovery();
    return true;
}

void GfxDevice::deleteTexture(TextureHandle texture) {
    const u32 id = static_cast<u32>(texture);
    auto* record = registry_.textures.find(id);
    if (!record) return;
    if (record->realized) backendDeleteTexture(id);
    if (record->owed) --owed_count_;
    eraseTexture(id);
    settleRecovery();
}

void GfxDevice::updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                              const void* pixels, bool flipY) {
    const u32 id = static_cast<u32>(texture);
    auto* record = registry_.textures.find(id);
    if (!record || !pixels || record->compressed) return;
    const TextureDesc& desc = record->desc;
    const bool whole = x == 0 && y == 0 && width >= desc.width && height >= desc.height;
    if (!record->bytes.empty()) {
        patchImage(record->bytes, desc.width, desc.height, gfxBytesPerPixel(desc.format),
                   x, y, width, height, static_cast<const u8*>(pixels), flipY);
    } else if (!record->realized && whole) {
        TextureDesc upload = desc;
        upload.flipY = flipY;
        keepBytes(record->bytes, uploadOrderImage(upload, pixels));
    }
    if (record->realized) backendUpdateTexture(id, x, y, width, height, pixels, flipY);
    if (whole) payTexture(id, *record);
}

void GfxDevice::setTextureParams(TextureHandle texture, TextureFilter min, TextureFilter mag,
                                 TextureWrap wrapS, TextureWrap wrapT) {
    const u32 id = static_cast<u32>(texture);
    auto* record = registry_.textures.find(id);
    if (!record) return;
    record->desc.minFilter = min;
    record->desc.magFilter = mag;
    record->desc.wrapS = wrapS;
    record->desc.wrapT = wrapT;
    if (record->realized) backendSetTextureParams(id, record->desc);
}

void GfxDevice::generateMipmaps(TextureHandle texture) {
    const u32 id = static_cast<u32>(texture);
    auto* record = registry_.textures.find(id);
    if (!record) return;
    record->desc.mipmaps = true;
    if (record->realized) backendGenerateMipmaps(id);
}

const TextureDesc* GfxDevice::textureDesc(TextureHandle texture) const {
    const auto* record = registry_.textures.find(static_cast<u32>(texture));
    return record ? &record->desc : nullptr;
}

// =============================================================================
// Programs
// =============================================================================

ShaderHandle GfxDevice::createProgram(const GfxShaderSource& source,
                                      const GfxAttribBinding* bindings, u32 bindingCount,
                                      std::string* outLog, GfxShaderStage* outFailedStage) {
    if (device_status_ == GfxDeviceStatus::Dead) {
        if (outLog) *outLog = "device dead";
        return ShaderHandle::Invalid;
    }
    GfxProgramRecord record;
    record.language = source.language;
    record.vertex = source.vertexSrc ? source.vertexSrc : "";
    record.fragment = source.fragmentSrc ? source.fragmentSrc : "";
    for (u32 i = 0; i < bindingCount; ++i) {
        record.attribBindings.emplace_back(bindings[i].index, bindings[i].name ? bindings[i].name : "");
    }
    const u32 id = registry_.programs.insert(std::move(record));
    if (!isDeviceUsable()) return ShaderHandle{id};
    if (!backendCreateProgram(id, source, bindings, bindingCount, outLog, outFailedStage)) {
        registry_.programs.erase(id);
        return ShaderHandle::Invalid;
    }
    registry_.programs.find(id)->realized = true;
    return ShaderHandle{id};
}

void GfxDevice::deleteProgram(ShaderHandle program) {
    const u32 id = static_cast<u32>(program);
    auto* record = registry_.programs.find(id);
    if (!record) return;
    if (record->realized) backendDeleteProgram(id);
    registry_.programs.erase(id);
    native_locations_.erase(id);
    if (current_program_ == program) current_program_ = ShaderHandle::Invalid;
}

void GfxDevice::useProgram(ShaderHandle program) {
    const u32 id = static_cast<u32>(program);
    current_program_ = program;
    if (!isDeviceUsable()) return;
    const auto* record = registry_.programs.find(id);
    if (!record) {
        backendUseProgram(0);
    } else if (record->realized) {
        backendUseProgram(id);
    }
}

i32 GfxDevice::nativeUniformLocation(GfxProgramRecord& record, u32 id, i32 location) {
    auto& natives = native_locations_[id];
    if (natives.size() < record.uniformNames.size()) natives.resize(record.uniformNames.size(), -2);
    i32& native = natives[static_cast<usize>(location)];
    if (native == -2) native = backendUniformLocation(id, record.uniformNames[static_cast<usize>(location)].c_str());
    return native;
}

i32 GfxDevice::getUniformLocation(ShaderHandle program, const char* name) {
    const u32 id = static_cast<u32>(program);
    auto* record = registry_.programs.find(id);
    if (!record || !name) return -1;
    auto it = std::find(record->uniformNames.begin(), record->uniformNames.end(), name);
    if (it != record->uniformNames.end()) {
        return static_cast<i32>(it - record->uniformNames.begin());
    }
    if (record->realized && backendUniformLocation(id, name) < 0) return -1;
    record->uniformNames.emplace_back(name);
    record->uniformValues.emplace_back();
    return static_cast<i32>(record->uniformNames.size() - 1);
}

i32 GfxDevice::getAttribLocation(ShaderHandle program, const char* name) {
    const u32 id = static_cast<u32>(program);
    const auto* record = registry_.programs.find(id);
    return record && record->realized ? backendAttribLocation(id, name) : -1;
}

void GfxDevice::setUniformValue(i32 location, const GfxUniformValue& value) {
    const u32 id = static_cast<u32>(current_program_);
    auto* record = registry_.programs.find(id);
    if (!record || location < 0 || static_cast<usize>(location) >= record->uniformValues.size()) return;
    record->uniformValues[static_cast<usize>(location)] = value;
    if (!record->realized) return;
    const i32 native = nativeUniformLocation(*record, id, location);
    if (native >= 0) backendSetUniform(native, value);
}

void GfxDevice::setUniform1i(i32 location, i32 value) {
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Int;
    v.i = value;
    setUniformValue(location, v);
}

void GfxDevice::setUniform1f(i32 location, f32 value) {
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Float;
    v.f[0] = value;
    setUniformValue(location, v);
}

void GfxDevice::setUniform2f(i32 location, f32 x, f32 y) {
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Vec2;
    v.f[0] = x;
    v.f[1] = y;
    setUniformValue(location, v);
}

void GfxDevice::setUniform3f(i32 location, f32 x, f32 y, f32 z) {
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Vec3;
    v.f[0] = x;
    v.f[1] = y;
    v.f[2] = z;
    setUniformValue(location, v);
}

void GfxDevice::setUniform4f(i32 location, f32 x, f32 y, f32 z, f32 w) {
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Vec4;
    v.f[0] = x;
    v.f[1] = y;
    v.f[2] = z;
    v.f[3] = w;
    setUniformValue(location, v);
}

void GfxDevice::setUniformMat3(i32 location, const f32* data) {
    if (!data) return;
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Mat3;
    std::memcpy(v.f, data, 9 * sizeof(f32));
    setUniformValue(location, v);
}

void GfxDevice::setUniformMat4(i32 location, const f32* data) {
    if (!data) return;
    GfxUniformValue v;
    v.type = GfxUniformValue::Type::Mat4;
    std::memcpy(v.f, data, 16 * sizeof(f32));
    setUniformValue(location, v);
}

std::vector<GfxUniformInfo> GfxDevice::getActiveUniforms(ShaderHandle program) {
    const u32 id = static_cast<u32>(program);
    auto* record = registry_.programs.find(id);
    if (!record || !record->realized) return {};
    std::vector<GfxUniformInfo> infos = backendActiveUniforms(id);
    for (GfxUniformInfo& info : infos) {
        const i32 native = info.location;
        info.location = getUniformLocation(program, info.name.c_str());
        if (info.location >= 0) {
            auto& natives = native_locations_[id];
            if (natives.size() < record->uniformNames.size()) natives.resize(record->uniformNames.size(), -2);
            natives[static_cast<usize>(info.location)] = native;
        }
    }
    return infos;
}

u32 GfxDevice::getUniformBlockIndex(ShaderHandle program, const char* name) {
    const u32 id = static_cast<u32>(program);
    auto* record = registry_.programs.find(id);
    if (!record || !name) return GFX_INVALID_UNIFORM_BLOCK;
    auto it = std::find(record->blockNames.begin(), record->blockNames.end(), name);
    if (it != record->blockNames.end()) return static_cast<u32>(it - record->blockNames.begin());
    if (record->realized && backendUniformBlockIndex(id, name) == GFX_INVALID_UNIFORM_BLOCK) {
        return GFX_INVALID_UNIFORM_BLOCK;
    }
    record->blockNames.emplace_back(name);
    record->blockBindings.push_back(GFX_UNBOUND_BLOCK);
    return static_cast<u32>(record->blockNames.size() - 1);
}

void GfxDevice::uniformBlockBinding(ShaderHandle program, u32 blockIndex, u32 bindingPoint) {
    const u32 id = static_cast<u32>(program);
    auto* record = registry_.programs.find(id);
    if (!record || blockIndex >= record->blockNames.size()) return;
    record->blockBindings[blockIndex] = bindingPoint;
    if (!record->realized) return;
    const u32 native = backendUniformBlockIndex(id, record->blockNames[blockIndex].c_str());
    if (native != GFX_INVALID_UNIFORM_BLOCK) backendUniformBlockBinding(id, native, bindingPoint);
}

// =============================================================================
// Framebuffers and queries
// =============================================================================

FramebufferHandle GfxDevice::createFramebuffer(const FramebufferDesc& desc) {
    if (device_status_ == GfxDeviceStatus::Dead) return FramebufferHandle::Default;
    const u32 id = registry_.framebuffers.insert(GfxFramebufferRecord{desc});
    if (!isDeviceUsable()) return FramebufferHandle{id};
    if (!backendCreateFramebuffer(id, desc)) {
        registry_.framebuffers.erase(id);
        return FramebufferHandle::Default;
    }
    registry_.framebuffers.find(id)->realized = true;
    return FramebufferHandle{id};
}

void GfxDevice::deleteFramebuffer(FramebufferHandle framebuffer) {
    const u32 id = static_cast<u32>(framebuffer);
    auto* record = registry_.framebuffers.find(id);
    if (!record) return;
    if (record->realized) backendDeleteFramebuffer(id);
    registry_.framebuffers.erase(id);
}

const FramebufferDesc* GfxDevice::framebufferDesc(FramebufferHandle framebuffer) const {
    const auto* record = registry_.framebuffers.find(static_cast<u32>(framebuffer));
    return record ? &record->desc : nullptr;
}

u32 GfxDevice::createTimerQuery() {
    if (!isDeviceUsable()) return 0;
    const u32 id = registry_.timerQueries.insert(GfxTimerQueryRecord{});
    if (!backendCreateTimerQuery(id)) {
        registry_.timerQueries.erase(id);
        return 0;
    }
    registry_.timerQueries.find(id)->realized = true;
    return id;
}

GfxLiveObjects GfxDevice::liveObjects() const {
    return GfxLiveObjects{
        registry_.buffers.size(),
        registry_.textures.size(),
        registry_.programs.size(),
        registry_.layouts.size(),
        registry_.pipelines.size(),
        registry_.framebuffers.size(),
        backendReadbackCount(),
    };
}

}  // namespace esengine
