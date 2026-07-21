// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  mixer.ts — Audio Mixer panel: bus strips, effects, ducking.
 */
import { defineMessages } from './types';

export const mixerMessages = defineMessages({
    'mix.panelTitle': { en: 'Audio Mixer', zh: '音频混音器' },
    'mix.noProjectTitle': { en: 'No project open', zh: '未打开项目' },
    'mix.noProject': { en: 'Open a project to edit its mixer.', zh: '打开项目后编辑其混音器。' },
    'mix.mute': { en: 'Mute', zh: '静音' },
    'mix.addBus': { en: 'Add Bus', zh: '添加总线' },
    'mix.removeBus': { en: 'Remove bus', zh: '移除总线' },
    'mix.duckBy': { en: 'Duck by', zh: '被压低于' },
    'mix.duckNone': { en: '(none)', zh: '（无）' },
    'mix.duckAmount': { en: 'Duck level while the trigger bus is active', zh: '触发总线活跃时压低到的音量' },

    'mix.fx.add': { en: '+ Effect', zh: '+ 效果' },
    'mix.fx.filter': { en: 'Filter', zh: '滤波器' },
    'mix.fx.filterKind': { en: 'Filter type', zh: '滤波类型' },
    'mix.fx.reverb': { en: 'Reverb', zh: '混响' },
    'mix.fx.compressor': { en: 'Compressor', zh: '压缩器' },
    'mix.fx.seconds': { en: 'Tail s', zh: '尾音秒' },
    'mix.fx.wet': { en: 'Wet', zh: '湿声' },
    'mix.fx.ratio': { en: 'Ratio', zh: '压缩比' },
    'mix.fx.remove': { en: 'Remove effect', zh: '移除效果' },
});
