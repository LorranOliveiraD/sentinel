// ─────────────────────────────────────────────
// Sentinel V3 — Regra de Saúde do Pipeline
// ─────────────────────────────────────────────
// DETERMINÍSTICO — IA não permitida neste módulo
// ─────────────────────────────────────────────

import type { RuleEvaluator, RuleInput, RuleResult, Finding } from '../../../types/policy.js';

/**
 * Avaliador de Regra de Saúde do Pipeline
 *
 * Penaliza PRs com checks de CI falhando.
 * Um pipeline falhando é um forte sinal de que o PR não está pronto para merge.
 */
export class PipelineHealthRule implements RuleEvaluator {
  readonly category = 'pipeline_health' as const;

  evaluate(input: RuleInput): RuleResult {
    const findings: Finding[] = [];
    const { overallStatus, failedChecks, pendingChecks } = input.ciAnalysis;

    if (overallStatus === 'failure') {
      const score = Math.min(30 + failedChecks.length * 10, 60);

      findings.push({
        id: 'pipeline-failure-1',
        rule: 'pipeline_health',
        severity: 'high',
        title: `CI pipeline failing (${failedChecks.length} check${failedChecks.length !== 1 ? 's' : ''})`,
        description: `The following CI checks are failing: ${failedChecks.join(', ')}. Fix the pipeline before requesting review.`,
        score,
        metadata: {
          overallStatus,
          failedChecks,
          pendingChecks,
        },
      });
    } else if (pendingChecks.length > 0 && overallStatus === 'pending') {
      findings.push({
        id: 'pipeline-pending-1',
        rule: 'pipeline_health',
        severity: 'info',
        title: `CI checks still running (${pendingChecks.length} pending)`,
        description: `The following CI checks are still running: ${pendingChecks.join(', ')}. Results may change once they complete.`,
        score: 5,
        metadata: {
          overallStatus,
          failedChecks,
          pendingChecks,
        },
      });
    }

    const totalScore = findings.reduce((sum, f) => sum + f.score, 0);

    return {
      rule: 'pipeline_health',
      findings,
      score: Math.min(totalScore, 60), // Limitado a 60
      passed: overallStatus !== 'failure',
    };
  }
}
