// ─────────────────────────────────────────────
// Sentinel — Calculador de Score de Risco
// ─────────────────────────────────────────────
// DETERMINÍSTICO — IA não permitida neste módulo
// ─────────────────────────────────────────────

import { createChildLogger } from '../../core/logger.js';
import type { RuleCategory, RuleResult, RiskScore, RuleWeights } from '../../types/policy.js';
import { DEFAULT_RULE_WEIGHTS } from '../../types/policy.js';

const log = createChildLogger({ service: 'risk-score' });

/**
 * Calculate a weighted risk score from rule evaluation results.
 *
 * Algorithm:
 * 1. Each rule's raw score (0-100) is weighted by its configured weight
 * 2. Weighted scores are summed and normalized to 0-100
 * 3. Author history adjustment is applied (±10 max)
 * 4. Final score is clamped to 0-100
 *
 * @param ruleResults - Results from all rule evaluators
 * @param authorHistoryAvg - Author's historical average risk score (null if unknown)
 * @param weights - Custom weights, or defaults
 * @returns Full risk score breakdown
 */
export function calculateRiskScore(
  ruleResults: RuleResult[],
  authorHistoryAvg: number | null = null,
  weights: RuleWeights = DEFAULT_RULE_WEIGHTS
): RiskScore {
  // Build breakdown: weighted score per rule
  const breakdown: Record<RuleCategory, number> = {
    secrets: 0,
    cve: 0,
    tests: 0,
    pr_size: 0,
    pipeline_health: 0,
  };

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);

  for (const result of ruleResults) {
    const weight = weights[result.rule] ?? 0;
    const weightedScore = (result.score * weight) / totalWeight;
    breakdown[result.rule] = Math.round(weightedScore * 100) / 100;
  }

  // Raw total before author adjustment
  const rawTotal = Object.values(breakdown).reduce((sum, s) => sum + s, 0);

  // Author history adjustment
  const authorAdjustment = calculateAuthorAdjustment(authorHistoryAvg);

  // Final normalized score clamped to 0-100
  const normalizedTotal = Math.max(0, Math.min(100, Math.round(rawTotal + authorAdjustment)));

  const riskScore: RiskScore = {
    total: normalizedTotal,
    breakdown,
    authorAdjustment,
    rawTotal: Math.round(rawTotal * 100) / 100,
    normalizedTotal,
  };

  log.info(
    {
      rawTotal: riskScore.rawTotal,
      authorAdjustment: riskScore.authorAdjustment,
      finalScore: riskScore.total,
      breakdown: riskScore.breakdown,
    },
    `Risk score calculated: ${riskScore.total}/100`
  );

  return riskScore;
}

/**
 * Calculate author history adjustment.
 *
 * - Authors with consistently high risk scores get a slight positive adjustment (+)
 * - Authors with consistently low risk scores get a slight negative adjustment (-)
 * - Unknown authors get no adjustment
 * - Adjustment is capped at ±10 to prevent over-reliance on history
 */
function calculateAuthorAdjustment(historicalAvg: number | null): number {
  if (historicalAvg === null) return 0;

  // Deviation from the "neutral" point of 30
  const deviation = historicalAvg - 30;

  // Scale: every 10 points of deviation = 2 points of adjustment
  const adjustment = (deviation / 10) * 2;

  // Clamp to ±10
  return Math.max(-10, Math.min(10, Math.round(adjustment * 100) / 100));
}
