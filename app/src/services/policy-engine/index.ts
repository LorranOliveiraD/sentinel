// ─────────────────────────────────────────────
// Sentinel V3 — Motor de Política (Núcleo Determinístico)
// ─────────────────────────────────────────────
// ⚠️ RESTRIÇÃO CRÍTICA: IA É PROIBIDA NESTE MÓDULO
//
// Este é o ÚNICO componente autorizado a decidir pass/warn/block.
// Todas as decisões são determinísticas e reproduzíveis.
// A mesma entrada SEMPRE produz a mesma saída.
// ─────────────────────────────────────────────

import { createChildLogger } from '../../core/logger.js';
import type {
  PolicyAction,
  PolicyDecision,
  RuleResult,
  RuleInput,
  RuleEvaluator,
} from '../../types/policy.js';
import type { SentinelRcConfig } from '../../types/config.js';
import { SecretsRule } from './rules/secrets.js';
import { CVERule } from './rules/cve.js';
import { TestsRule } from './rules/tests.js';
import { PRSizeRule } from './rules/pr-size.js';
import { PipelineHealthRule } from './rules/pipeline-health.js';
import { calculateRiskScore } from './risk-score.js';

const log = createChildLogger({ service: 'policy-engine' });

/** Todos os avaliadores de regra disponíveis */
const ALL_RULES: RuleEvaluator[] = [
  new SecretsRule(),
  new CVERule(),
  new TestsRule(),
  new PRSizeRule(),
  new PipelineHealthRule(),
];

/**
 * Avalia todas as regras de política e produz uma decisão determinística.
 *
 * Matriz de decisão:
 * - score < riskScoreWarn → PASS
 * - riskScoreWarn ≤ score < riskScoreBlock → WARN
 * - score ≥ riskScoreBlock → BLOCK
 *
 * @param input - Dados de análise agregados de todos os analisadores
 * @param config - Limiares a nível de repositório
 * @param authorHistoryAvg - Média histórica do autor (para ajuste de score)
 * @returns PolicyDecision com ação, detalhamento do score e todos os achados
 */
export function evaluatePolicy(
  input: RuleInput,
  config: SentinelRcConfig,
  authorHistoryAvg: number | null = null
): PolicyDecision {
  log.info('Avaliando regras de política...');

  // Determina quais regras executar
  const activeRules = getActiveRules(config);

  // Executa todas as regras ativas
  const ruleResults: RuleResult[] = [];

  for (const rule of activeRules) {
    log.debug({ rule: rule.category }, `Evaluating rule: ${rule.category}`);

    const result = rule.evaluate(input);
    ruleResults.push(result);

    log.info(
      {
        rule: rule.category,
        score: result.score,
        findings: result.findings.length,
        passed: result.passed,
      },
      `Rule "${rule.category}": score=${result.score}, findings=${result.findings.length}`
    );
  }

  // Calcula score de risco ponderado
  const riskScore = calculateRiskScore(ruleResults, authorHistoryAvg);

  // Determina ação (A decisão — determinística, sem IA)
  const action = determineAction(riskScore.total, config);

  // Coleta todos os achados
  const allFindings = ruleResults.flatMap((r) => r.findings);

  // Gera resumo
  const summary = generateSummary(action, riskScore.total, allFindings, ruleResults);

  const decision: PolicyDecision = {
    action,
    riskScore,
    findings: allFindings,
    ruleResults,
    summary,
    timestamp: new Date().toISOString(),
  };

  log.info(
    {
      action: decision.action,
      score: decision.riskScore.total,
      totalFindings: decision.findings.length,
      breakdown: decision.riskScore.breakdown,
    },
    `🛡️ Policy decision: ${decision.action.toUpperCase()} (score: ${decision.riskScore.total})`
  );

  return decision;
}

/**
 * DECISÃO DE AÇÃO DETERMINÍSTICA
 *
 * Esta função é o ponto único de verdade para resultados de PR.
 * Sem ambiguidade, sem IA, sem dependências externas.
 */
function determineAction(score: number, config: SentinelRcConfig): PolicyAction {
  if (score >= config.riskScoreBlock) return 'block';
  if (score >= config.riskScoreWarn) return 'warn';
  return 'pass';
}

/**
 * Obtém regras ativas baseado na configuração (habilitar/desabilitar).
 */
function getActiveRules(config: SentinelRcConfig): RuleEvaluator[] {
  return ALL_RULES.filter((rule) => {
    // Se enabledRules é especificado, inclui apenas essas
    if (config.enabledRules && config.enabledRules.length > 0) {
      return config.enabledRules.includes(rule.category);
    }

    // Se disabledRules é especificado, exclui essas
    if (config.disabledRules && config.disabledRules.length > 0) {
      return !config.disabledRules.includes(rule.category);
    }

    return true;
  });
}

/**
 * Gera um resumo legível da decisão de política.
 */
function generateSummary(
  action: PolicyAction,
  score: number,
  findings: PolicyDecision['findings'],
  ruleResults: RuleResult[]
): string {
  const emoji = action === 'pass' ? '✅' : action === 'warn' ? '⚠️' : '🚫';
  const actionLabel = action.toUpperCase();

  const failedRules = ruleResults.filter((r) => !r.passed).map((r) => r.rule);

  let summary = `${emoji} **Sentinel V3 — ${actionLabel}** (Risk Score: ${score}/100)\n\n`;

  if (findings.length === 0) {
    summary += 'No issues found. This PR looks clean.';
  } else {
    summary += `Found ${findings.length} issue${findings.length !== 1 ? 's' : ''}`;
    if (failedRules.length > 0) {
      summary += ` in: ${failedRules.join(', ')}`;
    }
    summary += '.\n\n';

    // Agrupa achados por regra
    const grouped = new Map<string, typeof findings>();
    for (const finding of findings) {
      const group = grouped.get(finding.rule) ?? [];
      group.push(finding);
      grouped.set(finding.rule, group);
    }

    for (const [rule, ruleFindings] of grouped) {
      summary += `**${rule}** (${ruleFindings.length}):\n`;
      for (const finding of ruleFindings.slice(0, 3)) {
        summary += `- ${finding.title}`;
        if (finding.file) summary += ` — \`${finding.file}\``;
        summary += '\n';
      }
      if (ruleFindings.length > 3) {
        summary += `- ... and ${ruleFindings.length - 3} more\n`;
      }
      summary += '\n';
    }
  }

  return summary;
}
