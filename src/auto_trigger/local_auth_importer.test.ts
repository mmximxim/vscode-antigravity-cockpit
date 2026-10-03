import { getAntigravityStateDbCandidates } from '../shared/antigravity_paths';

describe('LocalAuthImporter & Antigravity Paths', () => {
    it('getAntigravityStateDbCandidates should return array with candidate paths', () => {
        const candidates = getAntigravityStateDbCandidates();
        expect(Array.isArray(candidates)).toBe(true);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates.some(c => c.includes('state.vscdb'))).toBe(true);
    });
});
