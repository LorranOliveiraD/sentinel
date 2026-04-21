// ─────────────────────────────────────────────
// Sentinel V3 — Regra de Detecção de CVE
// ─────────────────────────────────────────────
// DETERMINÍSTICO — IA não permitida neste módulo
// ─────────────────────────────────────────────

import type { RuleEvaluator, RuleInput, RuleResult, Finding } from '../../../types/policy.js';

/** Mapeamento de severidade para score */
const SEVERITY_SCORES: Record<string, number> = {
  CRITICAL: 100,
  HIGH: 70,
  MODERATE: 40,
  MEDIUM: 40,
  LOW: 15,
};

/**
 * Avaliador de Regra CVE
 *
 * Mapeia achados de vulnerabilidades de dependências do analisador de deps
 * em achados de política com score.
 */
export class CVERule implements RuleEvaluator {
  readonly category = 'cve' as const;

  evaluate(input: RuleInput): RuleResult {
    const findings: Finding[] = [];

    for (const vuln of input.depAnalysis.vulnerabilities) {
      const severity = vuln.severity.toUpperCase();
      const score = SEVERITY_SCORES[severity] ?? 15;

      findings.push({
        id: `cve-${vuln.id}`,
        rule: 'cve',
        severity: mapSeverity(severity),
        title: `${vuln.id}: ${vuln.package}`,
        description: vuln.summary,
        score,
        metadata: {
          vulnId: vuln.id,
          package: vuln.package,
          originalSeverity: severity,
        },
      });
    }

    // Peso: score médio ponderado pela quantidade, limitado a 100
    const totalScore = findings.length > 0
      ? Math.min(
          findings.reduce((sum, f) => sum + f.score, 0),
          100
        )
      : 0;

    return {
      rule: 'cve',
      findings,
      score: totalScore,
      passed: findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length === 0,
    };
  }
}

function mapSeverity(severity: string): Finding['severity'] {
  switch (severity) {
    case 'CRITICAL': return 'critical';
    case 'HIGH': return 'high';
    case 'MODERATE':
    case 'MEDIUM': return 'medium';
    case 'LOW': return 'low';
    default: return 'info';
  }
}
