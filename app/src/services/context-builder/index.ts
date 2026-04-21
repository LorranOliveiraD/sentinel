// ─────────────────────────────────────────────
// Sentinel V3 — Serviço Construtor de Contexto
// ─────────────────────────────────────────────

import { createChildLogger } from '../../core/logger.js';
import type { PRAnalysisResult } from '../../types/github.js';
import type { Finding } from '../../types/policy.js';
import type { ContextReadyPayload } from '../../types/events.js';
import type { CIAnalysisResult } from '../ci-analyzer/index.js';
import type { DepAnalysisResult } from '../dep-analyzer/index.js';

const log = createChildLogger({ service: 'context-builder' });

/** Estimativa máxima de tokens para o contexto construído */
const MAX_TOKENS = 1000;

/** Aproximação grosseira: 1 token ≈ 4 caracteres */
const CHARS_PER_TOKEN = 4;

/** Dados de entrada para construção do contexto */
export interface ContextBuilderInput {
  correlationId: string;
  repository: { owner: string; repo: string };
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prAnalysis: PRAnalysisResult;
  ciAnalysis: CIAnalysisResult;
  depAnalysis: DepAnalysisResult;
  findings: Finding[];
  authorHistory?: {
    historicalRiskAvg: number | null;
    overrideCount: number;
  };
}

/**
 * Constrói um contexto JSON mínimo que satisfaz a restrição de ≤1000 tokens.
 *
 * Estratégia:
 * 1. Começa com metadados essenciais (PR + autor)
 * 2. Adiciona achados resumidos (contagens, não detalhes)
 * 3. Só inclui achados detalhados se houver orçamento de tokens restante
 * 4. Mede uso de tokens e trunca se necessário
 *
 * Restrição: saída deve reduzir uso de tokens em pelo menos 70% comparado à entrada bruta.
 */
export function buildContext(input: ContextBuilderInput): ContextReadyPayload {
  const rawInputSize = estimateTokens(JSON.stringify(input));

  log.info(
    { correlationId: input.correlationId, rawTokenEstimate: rawInputSize },
    'Construindo contexto mínimo'
  );

  // ── Contar achados por categoria ──
  const secretFindings = input.findings.filter((f) => f.rule === 'secrets').length;
  const cveFindings = input.findings.filter((f) => f.rule === 'cve');
  const testFindings = input.findings.some((f) => f.rule === 'tests' && !f.metadata?.testsIncluded);
  const pipelineHealthy = input.ciAnalysis.overallStatus === 'success' ||
    input.ciAnalysis.overallStatus === 'neutral';

  // ── Determinar categoria de tamanho do PR ──
  const totalChangedLines = input.prAnalysis.totalLinesAdded + input.prAnalysis.totalLinesRemoved;
  const prSize: 'small' | 'medium' | 'large' =
    totalChangedLines > 500 ? 'large' :
    totalChangedLines > 200 ? 'medium' : 'small';

  // ── Construir o contexto mínimo ──
  const context: ContextReadyPayload['context'] = {
    pr: {
      title: truncateString(input.prTitle, 100),
      author: input.prAuthor,
      linesAdded: input.prAnalysis.totalLinesAdded,
      linesRemoved: input.prAnalysis.totalLinesRemoved,
      filesChanged: input.prAnalysis.totalFilesChanged,
    },
    author: {
      username: input.prAuthor,
      historicalRiskAvg: input.authorHistory?.historicalRiskAvg ?? null,
      overrideCount: input.authorHistory?.overrideCount ?? 0,
    },
    findings: {
      secrets: secretFindings,
      cves: {
        critical: cveFindings.filter((f) => f.severity === 'critical').length,
        high: cveFindings.filter((f) => f.severity === 'high').length,
        moderate: cveFindings.filter((f) => f.severity === 'medium').length,
        low: cveFindings.filter((f) => f.severity === 'low').length,
      },
      testsIncluded: !testFindings,
      pipelineHealthy,
      prSize,
    },
    rawFindings: trimFindings(input.findings, MAX_TOKENS),
  };

  const tokenEstimate = estimateTokens(JSON.stringify(context));
  const reductionPercentage = rawInputSize > 0
    ? Math.round(((rawInputSize - tokenEstimate) / rawInputSize) * 100)
    : 0;

  log.info(
    {
      correlationId: input.correlationId,
      rawTokens: rawInputSize,
      contextTokens: tokenEstimate,
      reductionPct: reductionPercentage,
      findingsIncluded: context.rawFindings.length,
    },
    `Contexto construído — ${reductionPercentage}% de redução de tokens`
  );

  return {
    correlationId: input.correlationId,
    repository: input.repository,
    prNumber: input.prNumber,
    context,
    tokenEstimate,
  };
}

/**
 * Estima contagem de tokens a partir de uma string.
 * Usa a heurística aproximada de 1 token ≈ 4 caracteres.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Recorta lista de achados para caber no orçamento de tokens.
 * Prioriza achados de maior severidade.
 */
function trimFindings(findings: Finding[], maxTokens: number): Finding[] {
  // Ordena por severidade (crítico primeiro)
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  const sorted = [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
  );

  // Adiciona achados progressivamente até se aproximar do limite de tokens
  const result: Finding[] = [];
  let currentTokens = 0;
  const tokenBudget = Math.floor(maxTokens * 0.6); // Reserva 40% para metadados

  for (const finding of sorted) {
    const findingTokens = estimateTokens(JSON.stringify(finding));
    if (currentTokens + findingTokens > tokenBudget) break;
    result.push(finding);
    currentTokens += findingTokens;
  }

  return result;
}

/**
 * Trunca uma string para um comprimento máximo.
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}
