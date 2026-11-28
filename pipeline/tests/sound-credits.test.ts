/**
 * @file  CREDITS.md kept row by row: a new file gets the table, a file's row is replaced in place and keeps what a new
 *        credit leaves blank, a person's own words elsewhere are left alone, and a licence that forbids the use says so.
 */
import { describe, it, expect } from 'vitest';
import { creditOf, licenceWarnings, upsertCredit } from '../src/sound/credits';

describe('the credits table', () => {
    it('starts a file with the audio table and the row', () => {
        const md = upsertCredit(null, { file: 'assets/audio/wind.wav', title: 'Wind', author: 'felix.blume', source: 'https://freesound.org/s/156414/', licence: 'CC0 1.0', changes: 'Looped.' });
        expect(md).toMatch(/^# Credits/);
        expect(md).toContain('## Audio');
        expect(creditOf(md, 'assets/audio/wind.wav')).toEqual(['`assets/audio/wind.wav`', 'Wind', 'felix.blume', 'https://freesound.org/s/156414/', 'CC0 1.0', 'Looped.']);
    });

    it('replaces a row in place, keeping what the new credit leaves out', () => {
        let md = upsertCredit(null, { file: 'a.wav', title: 'A', author: 'Someone', licence: 'CC BY 4.0', changes: 'Old.' });
        md = upsertCredit(md, { file: 'b.wav', title: 'B', licence: 'CC0 1.0' });
        md = upsertCredit(md, { file: 'a.wav', changes: 'New.' });
        expect(creditOf(md, 'a.wav')).toEqual(['`a.wav`', 'A', 'Someone', '', 'CC BY 4.0', 'New.']);
        expect(md.indexOf('`a.wav`')).toBeLessThan(md.indexOf('`b.wav`'));
        expect(md.match(/`a\.wav`/g)).toHaveLength(1);
    });

    it('leaves the rest of a hand-written file alone, and adds the table where there is none', () => {
        const own = '# Credits\r\n\r\nFonts by Jane.\r\n';
        const md = upsertCredit(own, { file: 'x.wav', title: 'X | Y', licence: 'CC0 1.0' });
        expect(md.startsWith('# Credits\r\n\r\nFonts by Jane.')).toBe(true);
        expect(creditOf(md, 'x.wav')?.[1]).toBe('X \\| Y');
    });
});

describe('what a licence allows', () => {
    it('warns on no licence, no derivatives, non-commercial, and on attribution', () => {
        expect(licenceWarnings(undefined)[0]).toMatch(/no licence/);
        expect(licenceWarnings('CC BY-ND 4.0').join(' ')).toMatch(/forbids changed versions/);
        expect(licenceWarnings('CC BY-NC 4.0').join(' ')).toMatch(/commercial/);
        expect(licenceWarnings('CC BY 4.0').join(' ')).toMatch(/credits screen/);
        expect(licenceWarnings('CC0 1.0')).toEqual([]);
    });
});
