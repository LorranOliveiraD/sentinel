import { describe, it, expect } from 'vitest';
import { calculateRiskScore } from '../../src/services/policy-engine/risk-score.js';
import type { RuleResult, RuleWeights } from '../../src/types/policy.js';
import { DEFAULT_RULE_WEIGHTS } from '../../src/types/policy.js';

function mkResult(rule: RuleResult['rule'], score: number): RuleResult {
  return { rule, score, passed: score === 0, findings: [] };
}

describe('Risk Score Calculator', () => {
  it('returns 0 for all passing rules', () => {
    const r = [mkResult('secrets',0), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r).total).toBe(0);
  });

  it('calculates weighted score for single failing rule', () => {
    const r = [mkResult('secrets',100), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    const s = calculateRiskScore(r);
    expect(s.total).toBe(40);
    expect(s.breakdown.secrets).toBe(40);
  });

  it('combines multiple failing rules', () => {
    const r = [mkResult('secrets',100), mkResult('cve',100), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r).total).toBe(70);
  });

  it('caps at 100 when all rules max', () => {
    const r = [mkResult('secrets',100), mkResult('cve',100), mkResult('tests',100), mkResult('pr_size',100), mkResult('pipeline_health',100)];
    expect(calculateRiskScore(r).total).toBe(100);
  });

  it('uses default weights', () => {
    expect(DEFAULT_RULE_WEIGHTS.secrets).toBe(40);
    expect(DEFAULT_RULE_WEIGHTS.cve).toBe(30);
  });

  it('accepts custom weights', () => {
    const w: RuleWeights = { secrets:10, cve:10, tests:10, pr_size:10, pipeline_health:60 };
    const r = [mkResult('secrets',0), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',100)];
    expect(calculateRiskScore(r, null, w).total).toBe(60);
  });

  it('applies no adjustment for null author', () => {
    const r = [mkResult('secrets',50), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r, null).authorAdjustment).toBe(0);
  });

  it('applies positive adjustment for high-risk authors', () => {
    const r = [mkResult('secrets',0), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r, 80).authorAdjustment).toBeGreaterThan(0);
  });

  it('applies negative adjustment for low-risk authors', () => {
    const r = [mkResult('secrets',30), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r, 5).authorAdjustment).toBeLessThan(0);
  });

  it('caps author adjustment at ±10', () => {
    const r = [mkResult('secrets',0), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r, 100).authorAdjustment).toBeLessThanOrEqual(10);
    expect(calculateRiskScore(r, 0).authorAdjustment).toBeGreaterThanOrEqual(-10);
  });

  it('never returns score below 0', () => {
    const r = [mkResult('secrets',0), mkResult('cve',0), mkResult('tests',0), mkResult('pr_size',0), mkResult('pipeline_health',0)];
    expect(calculateRiskScore(r, 0).total).toBeGreaterThanOrEqual(0);
  });

  it('never returns score above 100', () => {
    const r = [mkResult('secrets',100), mkResult('cve',100), mkResult('tests',100), mkResult('pr_size',100), mkResult('pipeline_health',100)];
    expect(calculateRiskScore(r, 100).total).toBeLessThanOrEqual(100);
  });

  it('is deterministic', () => {
    const r = [mkResult('secrets',80), mkResult('cve',40), mkResult('tests',20), mkResult('pr_size',15), mkResult('pipeline_health',30)];
    const s1 = calculateRiskScore(r, 50);
    const s2 = calculateRiskScore(r, 50);
    expect(s1.total).toBe(s2.total);
    expect(s1.breakdown).toEqual(s2.breakdown);
  });

  it('includes all categories in breakdown', () => {
    const r = [mkResult('secrets',10), mkResult('cve',20), mkResult('tests',30), mkResult('pr_size',15), mkResult('pipeline_health',5)];
    const s = calculateRiskScore(r);
    expect(s.breakdown).toHaveProperty('secrets');
    expect(s.breakdown).toHaveProperty('cve');
    expect(s.breakdown).toHaveProperty('tests');
    expect(s.breakdown).toHaveProperty('pr_size');
    expect(s.breakdown).toHaveProperty('pipeline_health');
  });
});
