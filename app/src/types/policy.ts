// ─────────────────────────────────────────────
// Sentinel — Definições de Tipos do Motor de Política
// ─────────────────────────────────────────────

/** Ações que o Motor de Política pode decidir */
export type PolicyAction = 'pass' | 'warn' | 'block';

/** Níveis de severidade para achados */
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Categorias de regras avaliadas pelo Motor de Política */
export type RuleCategory = 'secrets' | 'cve' | 'tests' | 'pr_size' | 'pipeline_health';

/** Achado individual de uma regra de política */
export interface Finding {
  id: string;
  rule: RuleCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Resultado da avaliação de uma única regra */
export interface RuleResult {
  rule: RuleCategory;
  findings: Finding[];
  score: number;
  passed: boolean;
}

/** Detalhamento do score de risco */
export interface RiskScore {
  total: number;
  breakdown: Record<RuleCategory, number>;
  authorAdjustment: number;
  rawTotal: number;
  normalizedTotal: number;
}

/** Decisão final da política com todos os dados de suporte */
export interface PolicyDecision {
  action: PolicyAction;
  riskScore: RiskScore;
  findings: Finding[];
  ruleResults: RuleResult[];
  summary: string;
  explanation?: string;
  timestamp: string;
}

/** Entrada para um avaliador de regra de política */
export interface RuleInput {
  prAnalysis: {
    filesChanged: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch: string | null;
      isTestFile: boolean;
      isDependencyFile: boolean;
    }>;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalFilesChanged: number;
  };
  ciAnalysis: {
    overallStatus: string;
    failedChecks: string[];
    pendingChecks: string[];
  };
  depAnalysis: {
    dependencyFilesChanged: string[];
    vulnerabilities: Array<{
      id: string;
      package: string;
      severity: string;
      summary: string;
    }>;
  };
  config: {
    riskScoreWarn: number;
    riskScoreBlock: number;
    minTestCoverage: number;
    largePRLines: number;
  };
}

/** Interface que todos os avaliadores de regra devem implementar */
export interface RuleEvaluator {
  readonly category: RuleCategory;
  evaluate(input: RuleInput): RuleResult;
}

/** Configuração de pesos das regras */
export interface RuleWeights {
  secrets: number;
  cve: number;
  tests: number;
  pr_size: number;
  pipeline_health: number;
}

/** Pesos padrão das regras */
export const DEFAULT_RULE_WEIGHTS: RuleWeights = {
  secrets: 40,
  cve: 30,
  tests: 10,
  pr_size: 10,
  pipeline_health: 10,
};
