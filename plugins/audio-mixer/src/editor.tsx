// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createRoot } from 'react-dom/client';
import { definePlugin, type PluginContext } from '@estella/editor-api';
import { Mixer } from './Mixer';
import { PANEL_TITLE } from './strings';
import { CSS, RAIL_ICON } from './style';

export default definePlugin({
  activate(ctx: PluginContext) {
    ctx.panels.register({
      id: 'estella.audio-mixer.panel',
      title: PANEL_TITLE,
      placement: 'bottom',
      mount(host) {
        const style = document.createElement('style');
        style.textContent = CSS;
        host.appendChild(style);
        const root = createRoot(host.appendChild(document.createElement('div')));
        root.render(<Mixer ctx={ctx} />);
        // Unmount on the next tick: React refuses to unmount from inside the
        // render pass a panel close can be dispatched in.
        return () => setTimeout(() => root.unmount(), 0);
      },
    });

    ctx.commands.register({
      id: 'estella.audio-mixer.open',
      title: PANEL_TITLE,
      category: { en: 'Audio', 'zh-CN': '音频' },
      menu: 'window',
      run: () => ctx.panels.open('estella.audio-mixer.panel'),
    });

    ctx.activityBar.register({
      id: 'estella.audio-mixer.rail',
      title: PANEL_TITLE,
      icon: RAIL_ICON,
      run: () => ctx.panels.open('estella.audio-mixer.panel'),
    });
  },
});
