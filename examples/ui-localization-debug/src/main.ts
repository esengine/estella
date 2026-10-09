import {
    addPlugin, addSystemToSchedule, defineSystem, Schedule, Res, GetWorld,
    LocalizationPlugin, Localization, UIEvents, UIEventType, Text, UINode, px,
    type LocalizationAPI, type UIEventQueue, type World,
} from 'esengine';

const locales = ['en', 'zh-CN', 'ja', 'ko', 'ar', 'th'];
addPlugin(new LocalizationPlugin({ locale: 'en', fallback: 'en' }));
let locale = 0, pseudo = false, wide = false;
addSystemToSchedule(Schedule.Update, defineSystem([Res(Localization), Res(UIEvents), GetWorld()],
    (loc: LocalizationAPI, events: UIEventQueue, world: World) => {
        for (const event of events.query(UIEventType.Click)) {
            if (event.target === world.findEntityByName('LocaleButton')) { locale = (locale + 1) % locales.length; loc.setLocale(locales[locale]); }
            else if (event.target === world.findEntityByName('PseudoButton')) { pseudo = !pseudo; loc.setPseudoLocalization(pseudo ? { expansion: 1 } : null); }
            else if (event.target === world.findEntityByName('WidthButton')) {
                wide = !wide;
                const label = world.findEntityByName('English');
                if (label !== null) world.insert(label, UINode, { ...world.get(label, UINode), width: px(wide ? 600 : 220) });
            } else continue;
            const status = world.findEntityByName('Preview status');
            if (status !== null) world.insert(status, Text, { ...world.get(status, Text),
                content: `Preview: ${pseudo ? '100%' : 'off'} · Locale: ${loc.locale} · Box: ${wide ? 600 : 220}px` });
        }
    }, { name: 'LocalizationDebugControls' }));
