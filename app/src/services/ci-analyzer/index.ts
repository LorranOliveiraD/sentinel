// ─────────────────────────────────────────────
// Sentinel V3 — Serviço Analisador de CI
// ─────────────────────────────────────────────

import { createChildLogger } from '../../core/logger.js';
import type { GitHubCheckRun } from '../../types/github.js';

const log = createChildLogger({ service: 'ci-analyzer' });

/** Resultado da análise do pipeline de CI */
export interface CIAnalysisResult {
  overallStatus: 'success' | 'failure' | 'pending' | 'neutral';
  checkRuns: Array<{
    name: string;
    status: string;
    conclusion: string | null;
  }>;
  failedChecks: string[];
  pendingChecks: string[];
  totalChecks: number;
  successRate: number;
}

/**
 * Analisa os check runs de CI para um PR.
 *
 * Determina a saúde geral do pipeline agregando status individuais dos checks.
 * Qualquer falha única torna o status geral "failure".
 * Qualquer check pendente (sem falhas) torna o status "pending".
 *
 * @param checkRuns - Array de objetos de check run da API do GitHub
 * @returns Resultado estruturado da análise de CI
 */
export function analyzeCIPipeline(checkRuns: GitHubCheckRun[]): CIAnalysisResult {
  log.info({ checkCount: checkRuns.length }, 'Analisando pipeline de CI');

  if (checkRuns.length === 0) {
    log.info('Nenhum check run encontrado — tratando como neutro');
    return {
      overallStatus: 'neutral',
      checkRuns: [],
      failedChecks: [],
      pendingChecks: [],
      totalChecks: 0,
      successRate: 100,
    };
  }

  const mappedChecks = checkRuns.map((cr) => ({
    name: cr.name,
    status: cr.status,
    conclusion: cr.conclusion,
  }));

  const failedChecks = checkRuns
    .filter((cr) => cr.conclusion === 'failure' || cr.conclusion === 'timed_out')
    .map((cr) => cr.name);

  const pendingChecks = checkRuns
    .filter((cr) => cr.status !== 'completed')
    .map((cr) => cr.name);

  const successfulChecks = checkRuns.filter(
    (cr) => cr.status === 'completed' && cr.conclusion === 'success'
  ).length;

  const successRate = checkRuns.length > 0
    ? Math.round((successfulChecks / checkRuns.length) * 100)
    : 100;

  let overallStatus: CIAnalysisResult['overallStatus'];

  if (failedChecks.length > 0) {
    overallStatus = 'failure';
  } else if (pendingChecks.length > 0) {
    overallStatus = 'pending';
  } else if (successfulChecks === checkRuns.length) {
    overallStatus = 'success';
  } else {
    overallStatus = 'neutral';
  }

  const result: CIAnalysisResult = {
    overallStatus,
    checkRuns: mappedChecks,
    failedChecks,
    pendingChecks,
    totalChecks: checkRuns.length,
    successRate,
  };

  log.info(
    {
      overallStatus: result.overallStatus,
      totalChecks: result.totalChecks,
      failed: result.failedChecks.length,
      pending: result.pendingChecks.length,
      successRate: result.successRate,
    },
    'Análise de CI concluída'
  );

  return result;
}

/**
 * Determina se os resultados de CI devem bloquear o PR.
 * Usa uma heurística simples para decisões rápidas.
 */
export function isCIHealthy(result: CIAnalysisResult): boolean {
  return result.overallStatus === 'success' || result.overallStatus === 'neutral';
}
