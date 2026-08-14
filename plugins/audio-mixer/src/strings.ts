// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  strings.ts — the panel's own text, resolved against the editor's locale.
 *
 * A plugin renders its own UI, so it carries its own strings; `ctx.locale` is
 * what says which language the editor is speaking.
 */
import { localize, type LocalizedString } from '@estella/editor-api';

const TEXT = {
  panel: { en: 'Audio Mixer', 'zh-CN': '音频混音台' },
  noProject: { en: 'Open a project to mix its audio buses.', 'zh-CN': '打开一个项目才能调它的音频总线。' },
  addBus: { en: 'Add bus', 'zh-CN': '添加总线' },
  removeBus: { en: 'Remove bus', 'zh-CN': '删除总线' },
  volume: { en: 'Volume', 'zh-CN': '音量' },
  mute: { en: 'Mute', 'zh-CN': '静音' },
  addEffect: { en: 'Add effect…', 'zh-CN': '添加效果…' },
  removeEffect: { en: 'Remove effect', 'zh-CN': '删除效果' },
  filterKind: { en: 'Filter type', 'zh-CN': '滤波器类型' },
  seconds: { en: 'sec', 'zh-CN': '秒' },
  wet: { en: 'wet', 'zh-CN': '湿度' },
  ratio: { en: 'ratio', 'zh-CN': '压缩比' },
  duckBy: { en: 'Duck by', 'zh-CN': '被闪避' },
  duckNone: { en: 'none', 'zh-CN': '无' },
  duckAmount: { en: 'Duck amount', 'zh-CN': '闪避量' },
  fxFilter: { en: 'Filter', 'zh-CN': '滤波' },
  fxReverb: { en: 'Reverb', 'zh-CN': '混响' },
  fxCompressor: { en: 'Compressor', 'zh-CN': '压缩' },
} satisfies Record<string, LocalizedString>;

export interface Strings {
  panel: string;
  noProject: string;
  addBus: string;
  removeBus: string;
  volume: string;
  mute: string;
  addEffect: string;
  removeEffect: string;
  filterKind: string;
  seconds: string;
  wet: string;
  ratio: string;
  duckBy: string;
  duckNone: string;
  duckAmount: string;
  fx: { filter: string; reverb: string; compressor: string };
}

/** Every string resolved once for a locale. */
export function text(locale: string): Strings {
  const at = (key: keyof typeof TEXT) => localize(TEXT[key], locale);
  return {
    panel: at('panel'),
    noProject: at('noProject'),
    addBus: at('addBus'),
    removeBus: at('removeBus'),
    volume: at('volume'),
    mute: at('mute'),
    addEffect: at('addEffect'),
    removeEffect: at('removeEffect'),
    filterKind: at('filterKind'),
    seconds: at('seconds'),
    wet: at('wet'),
    ratio: at('ratio'),
    duckBy: at('duckBy'),
    duckNone: at('duckNone'),
    duckAmount: at('duckAmount'),
    fx: { filter: at('fxFilter'), reverb: at('fxReverb'), compressor: at('fxCompressor') },
  };
}

export const PANEL_TITLE: LocalizedString = TEXT.panel;
