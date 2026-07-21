import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIOS, DEMO_URL } from './default-scenarios';

describe('default Studio scenarios', () => {
  it('keep scenario and step ids globally unique', () => {
    const scenarioIds = DEFAULT_SCENARIOS.map((scenario) => scenario.id);
    const stepIds = DEFAULT_SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.id));

    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    expect(new Set(stepIds).size).toBe(stepIds.length);
  });

  it('start every scenario from the deterministic demo URL', () => {
    for (const scenario of DEFAULT_SCENARIOS) {
      expect(scenario.steps[0]).toEqual(expect.objectContaining({ kind: 'open', url: DEMO_URL }));
    }
  });

  it('use manifest targets for every interactive action', () => {
    for (const step of DEFAULT_SCENARIOS.flatMap((scenario) => scenario.steps)) {
      if (step.kind === 'click' || step.kind === 'fill' || step.kind === 'expect-target') {
        expect(step.target).toMatch(/^[a-z][a-z0-9_]*(?:\[key=[^\]]+\]\.[a-z][a-z0-9_]*)?$/);
      }
    }
  });
});
