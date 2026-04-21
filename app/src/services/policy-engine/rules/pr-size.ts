// ─────────────────────────────────────────────
// Sentinel V3 — Regra de Tamanho de PR
// ─────────────────────────────────────────────
// DETERMINÍSTICO — IA não permitida neste módulo
// ─────────────────────────────────────────────

import type { RuleEvaluator, RuleInput, RuleResult, Finding } from '../../../types/policy.js';

/**
 * Avaliador de Regra de Tamanho de PR
 *
 * Sinaliza PRs que excedem o limiar configurado de linhas alteradas.
 * PRs grandes são mais difíceis de revisar e mais propensos a conter problemas.
 */
export class PRSizeRule implements RuleEvaluator {
  readonly category = 'pr_size' as const;

  evaluate(input: RuleInput): RuleResult {
    const findings: Finding[] = [];
    const totalChanges = input.prAnalysis.totalLinesAdded + input.prAnalysis.totalLinesRemoved;
    const threshold = input.config.largePRLines;

    if (totalChanges > threshold) {
      const ratio = totalChanges / threshold;
      const score = calculateSizeScore(ratio);

      const sizeLabel = ratio > 3 ? 'extremely large' : ratio > 2 ? 'very large' : 'large';

      findings.push({
        id: 'pr-size-1',
        rule: 'pr_size',
        severity: ratio > 3 ? 'high' : ratio > 2 ? 'medium' : 'low',
        title: `PR is ${sizeLabel} (${totalChanges} lines)`,
        description: `This PR changes ${totalChanges} lines (${input.prAnalysis.totalLinesAdded} added, ${input.prAnalysis.totalLinesRemoved} removed) across ${input.prAnalysis.totalFilesChanged} files. The threshold is ${threshold} lines. Consider breaking it into smaller, focused PRs for easier review.`,
        score,
        metadata: {
          totalChanges,
          linesAdded: input.prAnalysis.totalLinesAdded,
          linesRemoved: input.prAnalysis.totalLinesRemoved,
          filesChanged: input.prAnalysis.totalFilesChanged,
          threshold,
          ratio: Math.round(ratio * 100) / 100,
        },
      });
    }

    const totalScore = findings.reduce((sum, f) => sum + f.score, 0);

    return {
      rule: 'pr_size',
      findings,
      score: Math.min(totalScore, 40), // Limitado a 40
      passed: findings.length === 0,
    };
  }
}

/**
 * Calcula score de tamanho baseado em quanto o PR excede o limiar.
 * Escala exponencial para penalizar PRs muito grandes com mais severidade.
 */
function calculateSizeScore(ratio: number): number {
  if (ratio <= 1) return 0;
  if (ratio <= 1.5) return 10;
  if (ratio <= 2) return 15;
  if (ratio <= 3) return 25;
  if (ratio <= 5) return 35;
  return 40; // Max score for enormous PRs
}
