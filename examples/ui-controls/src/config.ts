import type { Color } from 'esengine';

// Progress bar auto-animation speed, in progress-fraction per second.
export const PROGRESS_SPEED = 0.5;

// The difficulty toggles, in the order the group lists them. A UIToggleGroup on
// their common ancestor is what makes them exclusive — no code decides that.
export const DIFFICULTIES = ['Easy', 'Normal', 'Hard'] as const;

// Dropdown accent choices — selecting one re-tints the slider + progress fill.
// The names are authored on the UIDropdown; these are the colours they mean.
export interface Accent {
    name: string;
    color: Color;
}

export const ACCENTS: Accent[] = [
    { name: 'Azure', color: { r: 0.25, g: 0.56, b: 0.96, a: 1 } },
    { name: 'Emerald', color: { r: 0.20, g: 0.78, b: 0.52, a: 1 } },
    { name: 'Amber', color: { r: 0.98, g: 0.72, b: 0.22, a: 1 } },
    { name: 'Rose', color: { r: 0.96, g: 0.36, b: 0.52, a: 1 } },
];

// Every scene entity the systems address, by the name it carries there.
export const NAMED = [
    'ClickButton', 'ClicksLabel',
    'AnimateToggle',
    'EasyToggle', 'NormalToggle', 'HardToggle', 'DifficultyLabel',
    'VolumeSlider', 'VolumeSliderFill', 'VolumeLabel',
    'LoadingBarFill',
    'ModalButton', 'ModalClose', 'Modal',
    'AccentDropdown',
    'NameField', 'NameLabel',
] as const;
