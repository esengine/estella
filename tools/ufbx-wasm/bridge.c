// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  FBX → one self-describing blob, so the TypeScript importer never walks
 *        a ufbx struct across the wasm heap.
 *
 * The blob is shaped like a GLB: a JSON header describing the scene, and a
 * payload holding every large array, addressed by `[offset, length]` pairs. That
 * boundary is the whole point of this file — struct layouts stay on this side,
 * and a rebuild of ufbx cannot silently move a field the reader indexes by hand.
 *
 * What ufbx is asked to do here is the conversion nobody should write twice:
 * axes and units to the engine's (which are glTF's), geometry transforms turned
 * into real nodes, polygons triangulated, and Euler curves with their pivots and
 * pre-rotations baked into TRS keyframes.
 */
#include "ufbx.h"

#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#define ES_FBX_MAGIC 0x42465345u /* "ESFB" little-endian */
#define ES_FBX_BLOB_VERSION 1u

/** Weights per vertex the engine's skinning reads; the rest are dropped. */
#define ES_FBX_MAX_WEIGHTS 4

typedef struct {
    unsigned char *data;
    size_t size;
    size_t cap;
} es_buf;

static int es_buf_reserve(es_buf *b, size_t extra) {
    if (b->size + extra <= b->cap) return 1;
    size_t cap = b->cap ? b->cap : 4096;
    while (cap < b->size + extra) cap *= 2;
    unsigned char *data = (unsigned char *)realloc(b->data, cap);
    if (!data) return 0;
    b->data = data;
    b->cap = cap;
    return 1;
}

static int es_buf_write(es_buf *b, const void *data, size_t bytes) {
    if (!es_buf_reserve(b, bytes)) return 0;
    memcpy(b->data + b->size, data, bytes);
    b->size += bytes;
    return 1;
}

static int es_buf_text(es_buf *b, const char *text) {
    return es_buf_write(b, text, strlen(text));
}

static void es_buf_free(es_buf *b) {
    free(b->data);
    b->data = NULL;
    b->size = 0;
    b->cap = 0;
}

/* -- JSON writing ------------------------------------------------------- */

/**
 * A string as a JSON literal. FBX names carry whatever the authoring tool put
 * there — quotes, backslashes, control characters — and ufbx hands them over as
 * UTF-8 without a terminator, so the escaping happens here rather than in a
 * printf somewhere.
 */
static void json_string(es_buf *b, ufbx_string s) {
    es_buf_text(b, "\"");
    for (size_t i = 0; i < s.length; i++) {
        unsigned char c = (unsigned char)s.data[i];
        switch (c) {
            case '"': es_buf_text(b, "\\\""); break;
            case '\\': es_buf_text(b, "\\\\"); break;
            case '\n': es_buf_text(b, "\\n"); break;
            case '\r': es_buf_text(b, "\\r"); break;
            case '\t': es_buf_text(b, "\\t"); break;
            default:
                if (c < 0x20) {
                    char esc[8];
                    snprintf(esc, sizeof(esc), "\\u%04x", c);
                    es_buf_text(b, esc);
                } else {
                    es_buf_write(b, &c, 1);
                }
        }
    }
    es_buf_text(b, "\"");
}

static void json_cstr(es_buf *b, const char *text) {
    ufbx_string s = { text, strlen(text) };
    json_string(b, s);
}

static void json_int(es_buf *b, long long value) {
    char text[32];
    snprintf(text, sizeof(text), "%lld", value);
    es_buf_text(b, text);
}

/** A finite number, or `null` — a NaN in a JSON document is a parse error. */
static void json_number(es_buf *b, double value) {
    if (!isfinite(value)) {
        es_buf_text(b, "null");
        return;
    }
    char text[40];
    snprintf(text, sizeof(text), "%.9g", value);
    es_buf_text(b, text);
}

static void json_key(es_buf *b, const char *key) {
    json_cstr(b, key);
    es_buf_text(b, ":");
}

static void json_vec3(es_buf *b, ufbx_vec3 v) {
    es_buf_text(b, "[");
    json_number(b, v.x); es_buf_text(b, ",");
    json_number(b, v.y); es_buf_text(b, ",");
    json_number(b, v.z);
    es_buf_text(b, "]");
}

/* -- Blob assembly ------------------------------------------------------ */

typedef struct {
    es_buf json;
    es_buf payload;
    es_buf warnings;
    size_t warning_count;
} es_writer;

/**
 * Copies an array into the payload and writes its `[offset, length]` slice.
 * Every slice starts 4-byte aligned so the reader can view it as a typed array
 * without copying — an unaligned offset is a runtime error in JS, not a
 * slowdown.
 */
static void json_slice(es_writer *w, const void *data, size_t bytes) {
    size_t pad = (4 - (w->payload.size % 4)) % 4;
    if (pad) {
        const unsigned char zeros[4] = { 0, 0, 0, 0 };
        es_buf_write(&w->payload, zeros, pad);
    }
    size_t offset = w->payload.size;
    es_buf_write(&w->payload, data, bytes);
    es_buf_text(&w->json, "[");
    json_int(&w->json, (long long)offset);
    es_buf_text(&w->json, ",");
    json_int(&w->json, (long long)bytes);
    es_buf_text(&w->json, "]");
}

static void warn(es_writer *w, const char *text) {
    if (w->warning_count++) es_buf_text(&w->warnings, ",");
    json_cstr(&w->warnings, text);
}

static void warnf(es_writer *w, const char *format, ...) {
    char text[512];
    va_list args;
    va_start(args, format);
    vsnprintf(text, sizeof(text), format, args);
    va_end(args);
    warn(w, text);
}

/* -- Geometry ----------------------------------------------------------- */

typedef struct {
    float x, y, z;
} es_vec3;

typedef struct {
    float x, y;
} es_vec2;

typedef struct {
    float x, y, z, w;
} es_vec4;

typedef struct {
    uint16_t joints[ES_FBX_MAX_WEIGHTS];
} es_joints;

/**
 * One mesh part expanded into per-corner arrays and re-indexed. A part is the
 * run of faces sharing one material, which is exactly what one `.esmesh` holds
 * — the same split a glTF calls a primitive.
 */
typedef struct {
    size_t vertex_count;
    size_t index_count;
    es_vec3 *positions;
    es_vec3 *normals;
    es_vec2 *uvs;
    es_vec4 *colors;
    es_joints *joints;
    es_vec4 *weights;
    uint32_t *indices;
    int has_normals;
    int has_uvs;
    int has_colors;
    int has_skin;
} es_part;

static void es_part_free(es_part *p) {
    free(p->positions);
    free(p->normals);
    free(p->uvs);
    free(p->colors);
    free(p->joints);
    free(p->weights);
    free(p->indices);
    memset(p, 0, sizeof(*p));
}

static es_vec3 to_vec3(ufbx_vec3 v) {
    es_vec3 out = { (float)v.x, (float)v.y, (float)v.z };
    return out;
}

/**
 * The skin influences of one logical vertex, as the four the engine carries.
 * ufbx sorts a vertex's weights by descending strength, so the first four are
 * the strongest; they are renormalized because dropping the tail otherwise
 * shrinks the vertex toward the origin.
 */
static void read_skin_vertex(const ufbx_skin_deformer *skin, uint32_t vertex,
                             es_joints *out_joints, es_vec4 *out_weights) {
    memset(out_joints, 0, sizeof(*out_joints));
    memset(out_weights, 0, sizeof(*out_weights));
    if (vertex >= skin->vertices.count) return;

    ufbx_skin_vertex sv = skin->vertices.data[vertex];
    size_t taken = sv.num_weights < ES_FBX_MAX_WEIGHTS ? sv.num_weights : ES_FBX_MAX_WEIGHTS;
    float total = 0.0f;
    float values[ES_FBX_MAX_WEIGHTS] = { 0 };
    for (size_t i = 0; i < taken; i++) {
        ufbx_skin_weight sw = skin->weights.data[sv.weight_begin + i];
        out_joints->joints[i] = (uint16_t)sw.cluster_index;
        values[i] = (float)sw.weight;
        total += values[i];
    }
    if (total <= 0.0f) return;
    float *w = &out_weights->x;
    for (size_t i = 0; i < taken; i++) w[i] = values[i] / total;
}

/**
 * Expands one material part into vertex streams and re-indexes them.
 *
 * Attributes are read per index (a "corner"), which is how FBX stores them:
 * a vertex split by a hard edge or a UV seam has several. `ufbx_generate_indices`
 * merges the corners that agree on every stream, so what comes out is the
 * smallest vertex buffer that still draws what was authored.
 */
static int build_part(es_writer *w, const ufbx_mesh *mesh, const ufbx_mesh_part *part,
                      const ufbx_skin_deformer *skin, const char *label, es_part *out) {
    memset(out, 0, sizeof(*out));
    size_t corners = part->num_triangles * 3;
    if (corners == 0) return 0;

    out->has_normals = mesh->vertex_normal.exists;
    out->has_uvs = mesh->vertex_uv.exists;
    out->has_colors = mesh->vertex_color.exists;
    out->has_skin = skin != NULL;

    out->positions = (es_vec3 *)malloc(corners * sizeof(es_vec3));
    out->indices = (uint32_t *)malloc(corners * sizeof(uint32_t));
    if (out->has_normals) out->normals = (es_vec3 *)malloc(corners * sizeof(es_vec3));
    if (out->has_uvs) out->uvs = (es_vec2 *)malloc(corners * sizeof(es_vec2));
    if (out->has_colors) out->colors = (es_vec4 *)malloc(corners * sizeof(es_vec4));
    if (out->has_skin) {
        out->joints = (es_joints *)malloc(corners * sizeof(es_joints));
        out->weights = (es_vec4 *)malloc(corners * sizeof(es_vec4));
    }
    size_t tri_cap = mesh->max_face_triangles * 3;
    uint32_t *tri = (uint32_t *)malloc(tri_cap * sizeof(uint32_t));
    if (!out->positions || !out->indices || !tri
        || (out->has_normals && !out->normals) || (out->has_uvs && !out->uvs)
        || (out->has_colors && !out->colors)
        || (out->has_skin && (!out->joints || !out->weights))) {
        free(tri);
        es_part_free(out);
        warnf(w, "%s: out of memory expanding %zu triangles", label, part->num_triangles);
        return 0;
    }

    size_t at = 0;
    for (size_t f = 0; f < part->num_faces; f++) {
        ufbx_face face = mesh->faces.data[part->face_indices.data[f]];
        uint32_t tris = ufbx_triangulate_face(tri, tri_cap, mesh, face);
        for (uint32_t t = 0; t < tris * 3; t++) {
            uint32_t ix = tri[t];
            if (at >= corners) break;
            out->positions[at] = to_vec3(ufbx_get_vertex_vec3(&mesh->vertex_position, ix));
            if (out->has_normals) {
                out->normals[at] = to_vec3(ufbx_get_vertex_vec3(&mesh->vertex_normal, ix));
            }
            if (out->has_uvs) {
                ufbx_vec2 uv = ufbx_get_vertex_vec2(&mesh->vertex_uv, ix);
                out->uvs[at].x = (float)uv.x;
                out->uvs[at].y = (float)uv.y;
            }
            if (out->has_colors) {
                ufbx_vec4 c = ufbx_get_vertex_vec4(&mesh->vertex_color, ix);
                out->colors[at].x = (float)c.x;
                out->colors[at].y = (float)c.y;
                out->colors[at].z = (float)c.z;
                out->colors[at].w = (float)c.w;
            }
            if (out->has_skin) {
                read_skin_vertex(skin, mesh->vertex_indices.data[ix],
                                 &out->joints[at], &out->weights[at]);
            }
            at++;
        }
    }
    free(tri);
    if (at == 0) {
        es_part_free(out);
        return 0;
    }

    ufbx_vertex_stream streams[6];
    size_t stream_count = 0;
    streams[stream_count].data = out->positions;
    streams[stream_count].vertex_count = at;
    streams[stream_count++].vertex_size = sizeof(es_vec3);
    if (out->has_normals) {
        streams[stream_count].data = out->normals;
        streams[stream_count].vertex_count = at;
        streams[stream_count++].vertex_size = sizeof(es_vec3);
    }
    if (out->has_uvs) {
        streams[stream_count].data = out->uvs;
        streams[stream_count].vertex_count = at;
        streams[stream_count++].vertex_size = sizeof(es_vec2);
    }
    if (out->has_colors) {
        streams[stream_count].data = out->colors;
        streams[stream_count].vertex_count = at;
        streams[stream_count++].vertex_size = sizeof(es_vec4);
    }
    if (out->has_skin) {
        streams[stream_count].data = out->joints;
        streams[stream_count].vertex_count = at;
        streams[stream_count++].vertex_size = sizeof(es_joints);
        streams[stream_count].data = out->weights;
        streams[stream_count].vertex_count = at;
        streams[stream_count++].vertex_size = sizeof(es_vec4);
    }

    ufbx_error error;
    size_t unique = ufbx_generate_indices(streams, stream_count, out->indices, at, NULL, &error);
    if (error.type != UFBX_ERROR_NONE) {
        char message[UFBX_ERROR_INFO_LENGTH + 128];
        ufbx_format_error(message, sizeof(message), &error);
        warnf(w, "%s: %s", label, message);
        es_part_free(out);
        return 0;
    }
    out->vertex_count = unique;
    out->index_count = at;
    return 1;
}

/* -- Materials ---------------------------------------------------------- */

/**
 * Which product a material map's texture became. FBX addresses image files
 * through `ufbx_scene.texture_files[]`, already deduplicated, so a map carries
 * that index plus the wrapping the texture asked for.
 */
static void json_texture_ref(es_writer *w, const ufbx_material_map *map) {
    if (!map->texture || !map->texture_enabled || !map->texture->has_file
        || map->texture->file_index == UFBX_NO_INDEX) {
        es_buf_text(&w->json, "null");
        return;
    }
    const ufbx_texture *tex = map->texture;
    es_buf_text(&w->json, "{");
    json_key(&w->json, "file");
    json_int(&w->json, tex->file_index);
    es_buf_text(&w->json, ",");
    json_key(&w->json, "wrapU");
    json_int(&w->json, tex->wrap_u == UFBX_WRAP_CLAMP ? 1 : 0);
    es_buf_text(&w->json, ",");
    json_key(&w->json, "wrapV");
    json_int(&w->json, tex->wrap_v == UFBX_WRAP_CLAMP ? 1 : 0);
    es_buf_text(&w->json, ",");
    // A uv transform is authored intent this import cannot carry: the engine
    // samples the uvs as they are, so the reader says so rather than drawing
    // the texture in the wrong place.
    json_key(&w->json, "uvTransform");
    es_buf_text(&w->json, tex->has_uv_transform ? "true" : "false");
    es_buf_text(&w->json, "}");
}

/** One `ufbx_material_map` as a value/texture pair, or `null` when unset. */
static void json_material_map(es_writer *w, const char *key, const ufbx_material_map *map,
                              int components) {
    json_key(&w->json, key);
    if (!map->has_value && !map->texture) {
        es_buf_text(&w->json, "null");
        return;
    }
    es_buf_text(&w->json, "{");
    json_key(&w->json, "value");
    if (components <= 1) {
        json_number(&w->json, map->value_real);
    } else {
        es_buf_text(&w->json, "[");
        json_number(&w->json, map->value_vec4.x); es_buf_text(&w->json, ",");
        json_number(&w->json, map->value_vec4.y); es_buf_text(&w->json, ",");
        json_number(&w->json, map->value_vec4.z);
        if (components > 3) {
            es_buf_text(&w->json, ",");
            json_number(&w->json, map->value_vec4.w);
        }
        es_buf_text(&w->json, "]");
    }
    es_buf_text(&w->json, ",");
    json_key(&w->json, "hasValue");
    es_buf_text(&w->json, map->has_value ? "true" : "false");
    es_buf_text(&w->json, ",");
    json_key(&w->json, "texture");
    json_texture_ref(w, map);
    es_buf_text(&w->json, "}");
}

/* -- Scene -------------------------------------------------------------- */

static es_buf g_result;
static char g_error[UFBX_ERROR_INFO_LENGTH + 256];

/** The mesh a node draws, skipping nodes whose geometry carries nothing. */
static int node_draws(const ufbx_node *node) {
    return node->mesh && node->mesh->num_faces > 0;
}

static void write_nodes(es_writer *w, const ufbx_scene *scene) {
    json_key(&w->json, "nodes");
    es_buf_text(&w->json, "[");
    for (size_t i = 0; i < scene->nodes.count; i++) {
        const ufbx_node *node = scene->nodes.data[i];
        if (i) es_buf_text(&w->json, ",");
        es_buf_text(&w->json, "{");
        json_key(&w->json, "name");
        json_string(&w->json, node->name);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "parent");
        json_int(&w->json, node->parent ? (long long)node->parent->typed_id : -1);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "translation");
        json_vec3(&w->json, node->local_transform.translation);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "rotation");
        es_buf_text(&w->json, "[");
        json_number(&w->json, node->local_transform.rotation.x); es_buf_text(&w->json, ",");
        json_number(&w->json, node->local_transform.rotation.y); es_buf_text(&w->json, ",");
        json_number(&w->json, node->local_transform.rotation.z); es_buf_text(&w->json, ",");
        json_number(&w->json, node->local_transform.rotation.w);
        es_buf_text(&w->json, "],");
        json_key(&w->json, "scale");
        json_vec3(&w->json, node->local_transform.scale);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "mesh");
        json_int(&w->json, node_draws(node) ? (long long)node->mesh->typed_id : -1);
        es_buf_text(&w->json, ",");
        // A helper node exists because a geometry transform or a non-standard
        // inherit mode needed a place to live; naming it says why an entity the
        // artist never made is in the prefab.
        json_key(&w->json, "helper");
        es_buf_text(&w->json, node->is_geometry_transform_helper || node->is_scale_helper
                    ? "true" : "false");
        es_buf_text(&w->json, "}");
    }
    es_buf_text(&w->json, "],");
}

/**
 * Writes every mesh, split by material. Geometry is emitted per source mesh
 * rather than per node: an instanced mesh is one product that several entities
 * draw, which is what the prefab assembly already expects.
 */
static void write_meshes(es_writer *w, const ufbx_scene *scene) {
    json_key(&w->json, "meshes");
    es_buf_text(&w->json, "[");
    int first = 1;
    for (size_t m = 0; m < scene->meshes.count; m++) {
        const ufbx_mesh *mesh = scene->meshes.data[m];
        const ufbx_skin_deformer *skin = mesh->skin_deformers.count > 0
            ? mesh->skin_deformers.data[0] : NULL;
        if (mesh->skin_deformers.count > 1) {
            warnf(w, "mesh \"%s\": %zu skin deformers; only the first is imported",
                  mesh->name.data, mesh->skin_deformers.count);
        }
        if (mesh->blend_deformers.count > 0) {
            warnf(w, "mesh \"%s\": %zu blend shape(s) not imported",
                  mesh->name.data, mesh->blend_deformers.count);
        }
        if (skin && skin->clusters.count > 65535) {
            warnf(w, "mesh \"%s\": %zu bones exceed the 65535 a joint index holds",
                  mesh->name.data, skin->clusters.count);
            skin = NULL;
        }

        // A mesh with no material still has one part covering every face, so
        // both cases walk the same loop.
        size_t parts = mesh->material_parts.count;
        for (size_t p = 0; p < parts; p++) {
            const ufbx_mesh_part *part = &mesh->material_parts.data[p];
            char label[256];
            snprintf(label, sizeof(label), "mesh \"%s\"[%zu]", mesh->name.data, p);
            es_part built;
            if (!build_part(w, mesh, part, skin, label, &built)) continue;

            if (!first) es_buf_text(&w->json, ",");
            first = 0;
            es_buf_text(&w->json, "{");
            json_key(&w->json, "name");
            json_string(&w->json, mesh->name);
            es_buf_text(&w->json, ",");
            json_key(&w->json, "mesh");
            json_int(&w->json, (long long)mesh->typed_id);
            es_buf_text(&w->json, ",");
            json_key(&w->json, "part");
            json_int(&w->json, (long long)p);
            es_buf_text(&w->json, ",");
            json_key(&w->json, "material");
            json_int(&w->json, p < mesh->materials.count && mesh->materials.data[p]
                     ? (long long)mesh->materials.data[p]->typed_id : -1);
            es_buf_text(&w->json, ",");
            json_key(&w->json, "vertexCount");
            json_int(&w->json, (long long)built.vertex_count);
            es_buf_text(&w->json, ",");

            json_key(&w->json, "positions");
            json_slice(w, built.positions, built.vertex_count * sizeof(es_vec3));
            es_buf_text(&w->json, ",");
            json_key(&w->json, "normals");
            if (built.has_normals) {
                json_slice(w, built.normals, built.vertex_count * sizeof(es_vec3));
            } else {
                es_buf_text(&w->json, "null");
            }
            es_buf_text(&w->json, ",");
            json_key(&w->json, "uvs");
            if (built.has_uvs) {
                json_slice(w, built.uvs, built.vertex_count * sizeof(es_vec2));
            } else {
                es_buf_text(&w->json, "null");
            }
            es_buf_text(&w->json, ",");
            json_key(&w->json, "colors");
            if (built.has_colors) {
                json_slice(w, built.colors, built.vertex_count * sizeof(es_vec4));
            } else {
                es_buf_text(&w->json, "null");
            }
            es_buf_text(&w->json, ",");
            json_key(&w->json, "joints");
            if (built.has_skin) {
                json_slice(w, built.joints, built.vertex_count * sizeof(es_joints));
            } else {
                es_buf_text(&w->json, "null");
            }
            es_buf_text(&w->json, ",");
            json_key(&w->json, "weights");
            if (built.has_skin) {
                json_slice(w, built.weights, built.vertex_count * sizeof(es_vec4));
            } else {
                es_buf_text(&w->json, "null");
            }
            es_buf_text(&w->json, ",");
            json_key(&w->json, "indices");
            json_slice(w, built.indices, built.index_count * sizeof(uint32_t));

            if (built.has_skin) {
                es_buf_text(&w->json, ",");
                json_key(&w->json, "skinJoints");
                es_buf_text(&w->json, "[");
                for (size_t c = 0; c < skin->clusters.count; c++) {
                    if (c) es_buf_text(&w->json, ",");
                    const ufbx_node *bone = skin->clusters.data[c]->bone_node;
                    json_int(&w->json, bone ? (long long)bone->typed_id : -1);
                }
                es_buf_text(&w->json, "],");
                // The bind pose, one 4x4 per bone. ufbx keeps a 4x3 affine
                // matrix in column-major order; the fourth row is implicit, and
                // writing it out here is what makes the product a plain matrix
                // the runtime can multiply.
                json_key(&w->json, "inverseBindMatrices");
                size_t count = skin->clusters.count;
                float *matrices = (float *)calloc(count ? count * 16 : 1, sizeof(float));
                if (matrices) {
                    for (size_t c = 0; c < count; c++) {
                        const ufbx_matrix *m = &skin->clusters.data[c]->geometry_to_bone;
                        float *dst = matrices + c * 16;
                        for (int col = 0; col < 4; col++) {
                            dst[col * 4 + 0] = (float)m->cols[col].x;
                            dst[col * 4 + 1] = (float)m->cols[col].y;
                            dst[col * 4 + 2] = (float)m->cols[col].z;
                            dst[col * 4 + 3] = col == 3 ? 1.0f : 0.0f;
                        }
                    }
                    json_slice(w, matrices, count * 16 * sizeof(float));
                    free(matrices);
                } else {
                    es_buf_text(&w->json, "null");
                }
            }
            es_buf_text(&w->json, "}");
            es_part_free(&built);
        }
    }
    es_buf_text(&w->json, "],");
}

static void write_materials(es_writer *w, const ufbx_scene *scene) {
    json_key(&w->json, "materials");
    es_buf_text(&w->json, "[");
    for (size_t i = 0; i < scene->materials.count; i++) {
        const ufbx_material *mat = scene->materials.data[i];
        if (i) es_buf_text(&w->json, ",");
        es_buf_text(&w->json, "{");
        json_key(&w->json, "name");
        json_string(&w->json, mat->name);
        es_buf_text(&w->json, ",");
        // Which shading model the file actually described. A Phong material has
        // no metalness at all, and reporting it as one would invent a surface.
        json_key(&w->json, "shader");
        json_int(&w->json, (long long)mat->shader_type);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "pbr");
        es_buf_text(&w->json, mat->features.pbr.enabled ? "true" : "false");
        es_buf_text(&w->json, ",");
        json_key(&w->json, "twoSided");
        es_buf_text(&w->json, mat->features.double_sided.enabled ? "true" : "false");
        es_buf_text(&w->json, ",");

        json_material_map(w, "baseColor", &mat->pbr.base_color, 3);
        es_buf_text(&w->json, ",");
        json_material_map(w, "baseFactor", &mat->pbr.base_factor, 1);
        es_buf_text(&w->json, ",");
        json_material_map(w, "roughness", &mat->pbr.roughness, 1);
        es_buf_text(&w->json, ",");
        json_material_map(w, "glossiness", &mat->pbr.glossiness, 1);
        es_buf_text(&w->json, ",");
        json_material_map(w, "metalness", &mat->pbr.metalness, 1);
        es_buf_text(&w->json, ",");
        json_material_map(w, "emissionColor", &mat->pbr.emission_color, 3);
        es_buf_text(&w->json, ",");
        json_material_map(w, "emissionFactor", &mat->pbr.emission_factor, 1);
        es_buf_text(&w->json, ",");
        json_material_map(w, "opacity", &mat->pbr.opacity, 1);
        es_buf_text(&w->json, ",");
        json_material_map(w, "normalMap", &mat->pbr.normal_map, 3);
        es_buf_text(&w->json, ",");
        json_material_map(w, "occlusion", &mat->pbr.ambient_occlusion, 1);
        es_buf_text(&w->json, "}");
    }
    es_buf_text(&w->json, "],");
}

static void write_textures(es_writer *w, const ufbx_scene *scene) {
    json_key(&w->json, "textures");
    es_buf_text(&w->json, "[");
    for (size_t i = 0; i < scene->texture_files.count; i++) {
        const ufbx_texture_file *file = &scene->texture_files.data[i];
        if (i) es_buf_text(&w->json, ",");
        es_buf_text(&w->json, "{");
        json_key(&w->json, "filename");
        json_string(&w->json, file->filename);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "relativeFilename");
        json_string(&w->json, file->relative_filename);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "content");
        if (file->content.size > 0) {
            json_slice(w, file->content.data, file->content.size);
        } else {
            es_buf_text(&w->json, "null");
        }
        es_buf_text(&w->json, "}");
    }
    es_buf_text(&w->json, "],");
}

/**
 * Every animation stack, baked. FBX rotates in Euler angles around pivots that
 * the engine's Transform has no field for, so reading the curves as authored
 * would place a limb somewhere the source never did — the bake is what turns all
 * of it into the TRS keyframes a track can hold.
 */
static void write_animations(es_writer *w, const ufbx_scene *scene) {
    json_key(&w->json, "animations");
    es_buf_text(&w->json, "[");
    int first = 1;
    for (size_t s = 0; s < scene->anim_stacks.count; s++) {
        const ufbx_anim_stack *stack = scene->anim_stacks.data[s];
        ufbx_bake_opts opts;
        memset(&opts, 0, sizeof(opts));
        opts.trim_start_time = true;
        opts.key_reduction_enabled = true;
        // Rotation keys are left alone: the engine interpolates the four
        // components and renormalizes, and reduction assumes a slerp — over a
        // long merged segment the two paths are not the same arc.
        opts.key_reduction_rotation = false;

        ufbx_error error;
        ufbx_baked_anim *bake = ufbx_bake_anim(scene, stack->anim, &opts, &error);
        if (!bake) {
            char message[UFBX_ERROR_INFO_LENGTH + 128];
            ufbx_format_error(message, sizeof(message), &error);
            warnf(w, "animation \"%s\": %s", stack->name.data, message);
            continue;
        }
        if (bake->nodes.count == 0) {
            ufbx_free_baked_anim(bake);
            continue;
        }

        if (!first) es_buf_text(&w->json, ",");
        first = 0;
        es_buf_text(&w->json, "{");
        json_key(&w->json, "name");
        json_string(&w->json, stack->name);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "duration");
        // The stack's own playback range is what the file says the animation
        // lasts, but an exporter that wrote no range leaves it at zero — and a
        // clip that says it is zero seconds long plays nothing at all.
        double duration = bake->playback_duration;
        if (bake->key_time_max > duration) duration = bake->key_time_max;
        json_number(&w->json, duration);
        es_buf_text(&w->json, ",");
        json_key(&w->json, "nodes");
        es_buf_text(&w->json, "[");
        for (size_t n = 0; n < bake->nodes.count; n++) {
            const ufbx_baked_node *node = &bake->nodes.data[n];
            if (n) es_buf_text(&w->json, ",");
            es_buf_text(&w->json, "{");
            json_key(&w->json, "node");
            json_int(&w->json, (long long)node->typed_id);

            const char *names[3] = { "translation", "rotation", "scale" };
            size_t counts[3] = {
                node->translation_keys.count, node->rotation_keys.count, node->scale_keys.count,
            };
            for (int channel = 0; channel < 3; channel++) {
                es_buf_text(&w->json, ",");
                json_key(&w->json, names[channel]);
                size_t count = counts[channel];
                if (count == 0) {
                    es_buf_text(&w->json, "null");
                    continue;
                }
                size_t comps = channel == 1 ? 4 : 3;
                float *times = (float *)malloc(count * sizeof(float));
                float *values = (float *)malloc(count * comps * sizeof(float));
                if (!times || !values) {
                    free(times);
                    free(values);
                    es_buf_text(&w->json, "null");
                    warnf(w, "animation \"%s\": out of memory writing %s keys",
                          stack->name.data, names[channel]);
                    continue;
                }
                for (size_t k = 0; k < count; k++) {
                    if (channel == 1) {
                        ufbx_baked_quat key = node->rotation_keys.data[k];
                        times[k] = (float)key.time;
                        values[k * 4 + 0] = (float)key.value.x;
                        values[k * 4 + 1] = (float)key.value.y;
                        values[k * 4 + 2] = (float)key.value.z;
                        values[k * 4 + 3] = (float)key.value.w;
                    } else {
                        ufbx_baked_vec3 key = channel == 0
                            ? node->translation_keys.data[k] : node->scale_keys.data[k];
                        times[k] = (float)key.time;
                        values[k * 3 + 0] = (float)key.value.x;
                        values[k * 3 + 1] = (float)key.value.y;
                        values[k * 3 + 2] = (float)key.value.z;
                    }
                }
                es_buf_text(&w->json, "{");
                json_key(&w->json, "times");
                json_slice(w, times, count * sizeof(float));
                es_buf_text(&w->json, ",");
                json_key(&w->json, "values");
                json_slice(w, values, count * comps * sizeof(float));
                es_buf_text(&w->json, "}");
                free(times);
                free(values);
            }
            es_buf_text(&w->json, "}");
        }
        es_buf_text(&w->json, "]}");
        ufbx_free_baked_anim(bake);
    }
    es_buf_text(&w->json, "],");
}

/** What the file holds that this import has no place for. */
static void report_unimported(es_writer *w, const ufbx_scene *scene) {
    if (scene->lights.count > 0) {
        warnf(w, "%zu light(s) are not imported", scene->lights.count);
    }
    if (scene->cameras.count > 0) {
        warnf(w, "%zu camera(s) are not imported", scene->cameras.count);
    }
    for (size_t i = 0; i < scene->metadata.warnings.count; i++) {
        const ufbx_warning *warning = &scene->metadata.warnings.data[i];
        if (warning->count > 1) {
            warnf(w, "%s (x%zu)", warning->description.data, warning->count);
        } else {
            warn(w, warning->description.data);
        }
    }
}

/**
 * Parses `data` and leaves the blob in `g_result`.
 *
 * @param filename What the source is called, so a texture's relative path
 *        resolves the way the file meant it to.
 * @return 1 on success; 0 leaves the reason in {@link es_fbx_error}.
 */
int es_fbx_load(const unsigned char *data, size_t size, const char *filename) {
    es_buf_free(&g_result);
    g_error[0] = '\0';

    ufbx_load_opts opts;
    memset(&opts, 0, sizeof(opts));
    // The engine's world matches glTF's: right-handed, +Y up, one unit is one
    // metre. Everything downstream — the prefab, the animation tracks, the
    // import scale a user sets — is written against that.
    opts.target_axes = ufbx_axes_right_handed_y_up;
    opts.target_unit_meters = 1.0f;
    opts.space_conversion = UFBX_SPACE_CONVERSION_MODIFY_GEOMETRY;
    // FBX lets geometry sit at an offset from its node with no node to hold it.
    // Helper nodes turn that into hierarchy the prefab can express; modifying
    // the geometry instead would be wrong for anything instanced.
    opts.geometry_transform_handling = UFBX_GEOMETRY_TRANSFORM_HANDLING_HELPER_NODES;
    opts.inherit_mode_handling = UFBX_INHERIT_MODE_HANDLING_HELPER_NODES;
    // Helper nodes become entities in the prefab, and an unnamed entity is one
    // nothing can address — an animation track resolves its target by name.
    opts.geometry_transform_helper_name.data = "GeometryTransform";
    opts.geometry_transform_helper_name.length = strlen("GeometryTransform");
    opts.scale_helper_name.data = "ScaleHelper";
    opts.scale_helper_name.length = strlen("ScaleHelper");
    // Texture paths become project paths; a Windows-authored file spells them
    // with backslashes, which no other reader here would resolve.
    opts.path_separator = '/';
    opts.generate_missing_normals = true;
    opts.normalize_normals = true;
    opts.clean_skin_weights = true;
    // Blender writes PBR materials as legacy Phong in a known way; without this
    // its roughness and metalness maps are invisible to the reader.
    opts.use_blender_pbr_material = true;
    // There is no filesystem here: images are resolved by the caller, which is
    // also what lets it bring them into the project.
    opts.load_external_files = false;
    opts.ignore_missing_external_files = true;
    if (filename && filename[0]) {
        opts.filename.data = filename;
        opts.filename.length = strlen(filename);
    }

    ufbx_error error;
    ufbx_scene *scene = ufbx_load_memory(data, size, &opts, &error);
    if (!scene) {
        ufbx_format_error(g_error, sizeof(g_error), &error);
        return 0;
    }

    es_writer w;
    memset(&w, 0, sizeof(w));
    es_buf_text(&w.json, "{");
    json_key(&w.json, "fileFormat");
    json_int(&w.json, (long long)scene->metadata.file_format);
    es_buf_text(&w.json, ",");
    json_key(&w.json, "creator");
    json_string(&w.json, scene->metadata.creator);
    es_buf_text(&w.json, ",");
    write_nodes(&w, scene);
    write_meshes(&w, scene);
    write_materials(&w, scene);
    write_textures(&w, scene);
    write_animations(&w, scene);
    report_unimported(&w, scene);
    json_key(&w.json, "warnings");
    es_buf_text(&w.json, "[");
    es_buf_write(&w.json, w.warnings.data, w.warnings.size);
    es_buf_text(&w.json, "]}");

    ufbx_free_scene(scene);

    uint32_t header[4] = {
        ES_FBX_MAGIC, ES_FBX_BLOB_VERSION,
        (uint32_t)w.json.size, (uint32_t)w.payload.size,
    };
    size_t pad = (4 - (w.json.size % 4)) % 4;
    const unsigned char zeros[4] = { 0, 0, 0, 0 };
    int ok = es_buf_write(&g_result, header, sizeof(header))
        && es_buf_write(&g_result, w.json.data, w.json.size)
        && (pad == 0 || es_buf_write(&g_result, zeros, pad))
        && (w.payload.size == 0 || es_buf_write(&g_result, w.payload.data, w.payload.size));

    es_buf_free(&w.json);
    es_buf_free(&w.payload);
    es_buf_free(&w.warnings);
    if (!ok) {
        es_buf_free(&g_result);
        snprintf(g_error, sizeof(g_error), "out of memory assembling the result");
        return 0;
    }
    return 1;
}

const unsigned char *es_fbx_result_data(void) {
    return g_result.data;
}

size_t es_fbx_result_size(void) {
    return g_result.size;
}

const char *es_fbx_error(void) {
    return g_error;
}

/** Hands the blob's memory back — an import per file would otherwise keep the
 *  largest one alive for the life of the process. */
void es_fbx_release(void) {
    es_buf_free(&g_result);
}
