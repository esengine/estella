import { describe, expect, it } from 'vitest';
import { aiRegistry, registerCondition } from '../src/ai/fsm/AiContext';

describe('registerCondition', () => {
    it('takes a spec with what the check reads, as the registry does', () => {
        registerCondition('test.specCondition', { check: () => true, touches: { reads: ['Health'] } });
        expect(aiRegistry.getCondition('test.specCondition')).toBeTypeOf('function');
        expect(aiRegistry.conditionTouches('test.specCondition')).toEqual({ reads: ['Health'] });
    });

    it('still takes a bare predicate, which declares nothing', () => {
        registerCondition('test.bareCondition', () => false);
        expect(aiRegistry.getCondition('test.bareCondition')).toBeTypeOf('function');
        expect(aiRegistry.conditionTouches('test.bareCondition')).toBeUndefined();
    });
});
