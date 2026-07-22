// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  material.ts — Material graph editor + UI Widgets palette.
 */
import { defineMessages } from './types';

export const materialMessages = defineMessages({
    // — Material Graph editor (panels/MaterialGraphEditor.tsx) —
    'mat.panelTitle': { en: 'Material Graph', zh: '材质图' },
    'mat.openHintPrefix': { en: 'Open a ', zh: '从内容浏览器打开 ' },
    'mat.openHintSuffix': { en: ' from the Content Browser to edit it.', zh: ' 文件进行编辑。' },
    'mat.graphEmpty': { en: 'No material graph open', zh: '未打开材质图' },
    'mat.add': { en: 'Add', zh: '添加' },
    'mat.addNode': { en: 'Add node', zh: '添加节点' },
    'mat.deleteNode': { en: 'Delete node', zh: '删除节点' },
    'mat.deleteSelected': { en: 'Delete selected', zh: '删除所选' },
    'mat.save': { en: 'Save', zh: '保存' },
    'mat.addNodeType': { en: 'Add {label}', zh: '添加 {label}' },
    'mat.emptyHint': {
        en: 'Right-click to add a node, then drag from an output port into a typed input.',
        zh: '右键单击添加节点，然后从输出端口拖拽连线到类型匹配的输入端口。',
    },

    // — Material graph open/create/save feedback (material/openMaterialGraph.ts) —
    'mat.openGraphFailed': { en: 'Failed to open material graph: {error}', zh: '打开材质图失败：{error}' },
    'mat.graphSaved': { en: 'Material graph saved', zh: '材质图已保存' },
    'mat.saveGraphFailed': { en: 'Failed to save material graph: {error}', zh: '保存材质图失败：{error}' },
    'mat.createGraphFailed': { en: 'Failed to create material graph: {error}', zh: '创建材质图失败：{error}' },
    'mat.createdGraph': { en: 'Created material graph: {name}', zh: '已创建材质图：{name}' },

    // — Material create feedback (material/openMaterial.ts) —
    'mat.unknownTemplate': { en: 'Unknown material template: {id}', zh: '未知的材质模板：{id}' },
    'mat.createFailed': { en: 'Failed to create material: {error}', zh: '创建材质失败：{error}' },
    'mat.created': { en: 'Created material: {name}', zh: '已创建材质：{name}' },
    'mat.createInstanceFailed': { en: 'Failed to create material instance: {error}', zh: '创建材质实例失败：{error}' },
    'mat.createdInstance': { en: 'Created material instance: {name}', zh: '已创建材质实例：{name}' },
    'mat.convertFailed': { en: 'Failed to convert shader: {error}', zh: '转换着色器失败：{error}' },
    'mat.convertedShader': { en: 'Extracted shader: {name}', zh: '已提取着色器：{name}' },
    'mat.createShaderFailed': { en: 'Failed to create shader: {error}', zh: '创建着色器失败：{error}' },
    'mat.createdShader': { en: 'Created shader: {name}', zh: '已创建着色器：{name}' },

    // — Material inspector sections + render state (material/materialInspectorModel.ts) —
    'mat.shader': { en: 'Shader', zh: '着色器' },
    'mat.shaderTip': {
        en: 'The shader that defines this material’s parameters and how it renders. Pick another to switch effects, or share one shader across several materials.',
        zh: '定义此材质参数与渲染方式的着色器。选择其他着色器可切换效果，也可让多个材质共用同一个着色器。',
    },
    'mat.shaderInherited': { en: 'Shader inherited from the parent material.', zh: '着色器继承自父材质。' },
    'mat.shaderMissing': {
        en: 'Shader “{ref}” not found — it may have been renamed or moved. Pick it again below.',
        zh: '未找到着色器“{ref}”——它可能已被重命名或移动。请在下方重新选择。',
    },
    'mat.shaderBuiltin': { en: 'Built-in · {name}', zh: '内置 · {name}' },
    'mat.convertToUnique': { en: 'Convert to Unique Shader', zh: '转为独立着色器' },
    'mat.convertToUniqueTip': {
        en: 'Copy this built-in shader into an editable .esshader file beside the material, so you can hand-edit its source.',
        zh: '把这个内置着色器复制成材质旁的可编辑 .esshader 文件，以便手动编辑其源码。',
    },
    'mat.parameters': { en: 'Parameters', zh: '参数' },
    'mat.renderState': { en: 'Render State', zh: '渲染状态' },
    'mat.blendMode': { en: 'Blend Mode', zh: '混合模式' },
    'mat.depthTest': { en: 'Depth Test', zh: '深度测试' },
    'mat.depthWrite': { en: 'Depth Write', zh: '深度写入' },
    'mat.cull': { en: 'Cull', zh: '剔除' },
    'mat.blendNormal': { en: 'Normal', zh: '正常' },
    'mat.blendAdditive': { en: 'Additive', zh: '相加' },
    'mat.blendMultiply': { en: 'Multiply', zh: '正片叠底' },
    'mat.blendScreen': { en: 'Screen', zh: '滤色' },
    'mat.blendPremultiplied': { en: 'Premultiplied', zh: '预乘' },
    'mat.cullNone': { en: 'None', zh: '无' },
    'mat.cullBack': { en: 'Back', zh: '背面' },
    'mat.cullFront': { en: 'Front', zh: '正面' },

    // — UI Widgets palette (panels/UIWidgetsPanel.tsx) —
    'uiw.hint': {
        en: 'Drag onto the canvas, or click to add under the Canvas.',
        zh: '拖拽到画布上，或点击添加到 Canvas 下。',
    },
});
