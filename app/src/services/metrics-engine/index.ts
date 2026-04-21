// ─────────────────────────────────────────────
// Sentinel V3 — Serviço do Motor de Métricas
// ─────────────────────────────────────────────

import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ service: 'metrics-engine' });

/** Métricas DORA */
export interface DORAMetrics {
  deploymentFrequency: {
    value: number;
    unit: 'per_day' | 'per_week';
    trend: 'up' | 'down' | 'stable';
  };
  leadTime: {
    value: number;
    unit: 'hours';
    trend: 'up' | 'down' | 'stable';
  };
  changeFailureRate: {
    value: number;
    unit: 'percentage';
    trend: 'up' | 'down' | 'stable';
  };
  mttr: {
    value: number;
    unit: 'hours';
    trend: 'up' | 'down' | 'stable';
  };
}

/** Métricas Comportamentais */
export interface BehavioralMetrics {
  rubberStampRate: {
    value: number;
    unit: 'percentage';
    description: string;
  };
  reviewConcentration: {
    value: number;
    unit: 'percentage';
    topReviewer: string | null;
    description: string;
  };
  overrideRate: {
    value: number;
    unit: 'percentage';
    description: string;
  };
  riskTrend: {
    current: number;
    previous: number;
    trend: 'up' | 'down' | 'stable';
    description: string;
  };
}

/** Snapshot completo de métricas */
export interface MetricsSnapshot {
  timestamp: string;
  period: string;
  dora: DORAMetrics;
  behavioral: BehavioralMetrics;
  summary: string;
}

/**
 * Calcula métricas DORA a partir dos dados de análise armazenados.
 *
 * Nota: Em uma implementação completa, estas seriam calculadas a partir de
 * dados de implantação, tempos de merge de PR e registros de incidentes.
 * Atualmente usa dados de análise como proxy.
 */
export function calculateDORAMetrics(
  aggregatedData: { totalAnalyses: number; avgRisk: number },
  repoFailureRates: { repo: string; total: number; failures: number }[]
): DORAMetrics {
  log.info('Calculando métricas DORA');

  const { totalAnalyses, avgRisk } = aggregatedData;

  // Métricas de proxy baseadas nos dados disponíveis
  const dora: DORAMetrics = {
    deploymentFrequency: {
      value: Math.round(totalAnalyses / 7), // PRs por dia (proxy)
      unit: 'per_day',
      trend: 'stable',
    },
    leadTime: {
      value: 24, // Espaço reservado — precisa de dados de tempo de merge de PR
      unit: 'hours',
      trend: 'stable',
    },
    changeFailureRate: {
      value: repoFailureRates.length > 0
        ? Math.round(
            repoFailureRates.reduce((sum, r) => sum + (r.failures / Math.max(r.total, 1)), 0) / repoFailureRates.length * 100
          )
        : 0,
      unit: 'percentage',
      trend: avgRisk > 40 ? 'up' : 'stable',
    },
    mttr: {
      value: 4, // Espaço reservado — precisa de dados de incidentes
      unit: 'hours',
      trend: 'stable',
    },
  };

  log.info({ dora }, 'Métricas DORA calculadas');
  return dora;
}

/**
 * Calcula métricas comportamentais a partir dos dados do desenvolvedor e do repositório.
 */
export function calculateBehavioralMetrics(
  aggregatedData: {
    totalAnalyses: number;
    zeroRiskAnalyses: number;
    totalOverrides: number;
    topReviewer: { username: string; count: number } | null;
    recentScores: number[];
    olderScores: number[];
  }
): BehavioralMetrics {
  log.info('Calculando métricas comportamentais');

  const {
    totalAnalyses,
    zeroRiskAnalyses,
    totalOverrides,
    topReviewer,
    recentScores,
    olderScores,
  } = aggregatedData;

  // Taxa de "rubber stamp": % de análises com score de risco 0 (nenhum achado)
  const rubberStampRate = totalAnalyses > 0
    ? Math.round((zeroRiskAnalyses / totalAnalyses) * 100)
    : 0;

  // Concentração de revisões: uma pessoa faz a maioria das revisões?
  const topReviewerShare = topReviewer && totalAnalyses > 0
    ? Math.round((topReviewer.count / totalAnalyses) * 100)
    : 0;

  // Taxa de override
  const overrideRate = totalAnalyses > 0
    ? Math.round((totalOverrides / totalAnalyses) * 100)
    : 0;

  // Tendência de risco: compara recente vs. histórico
  const recentAvg = recentScores.length > 0
    ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length)
    : 0;
  const olderAvg = olderScores.length > 0
    ? Math.round(olderScores.reduce((a, b) => a + b, 0) / olderScores.length)
    : recentAvg;

  const behavioral: BehavioralMetrics = {
    rubberStampRate: {
      value: rubberStampRate,
      unit: 'percentage',
      description: `${rubberStampRate}% dos PRs não tiveram achados (potencial "rubber stamping")`,
    },
    reviewConcentration: {
      value: topReviewerShare,
      unit: 'percentage',
      topReviewer: topReviewer?.username ?? null,
      description: topReviewer
        ? `${topReviewer.username} representa ${topReviewerShare}% de toda a atividade de PR`
        : 'Nenhum dado disponível',
    },
    overrideRate: {
      value: overrideRate,
      unit: 'percentage',
      description: `${overrideRate}% das análises sofreram override`,
    },
    riskTrend: {
      current: recentAvg,
      previous: olderAvg,
      trend: recentAvg > olderAvg + 5 ? 'up' : recentAvg < olderAvg - 5 ? 'down' : 'stable',
      description: `Score de risco médio: ${recentAvg} (era ${olderAvg})`,
    },
  };

  log.info({ behavioral }, 'Métricas comportamentais calculadas');
  return behavioral;
}

/**
 * Gera um snapshot completo de métricas (agora espera os dados agregados).
 */
export function generateMetricsSnapshot(
  aggregatedData: {
    totalAnalyses: number;
    avgRisk: number;
    zeroRiskAnalyses: number;
    totalOverrides: number;
    topReviewer: { username: string; count: number } | null;
    recentScores: number[];
    olderScores: number[];
  },
  repoFailureRates: { repo: string; total: number; failures: number }[]
): MetricsSnapshot {
  const dora = calculateDORAMetrics(aggregatedData, repoFailureRates);
  const behavioral = calculateBehavioralMetrics(aggregatedData);

  const snapshot: MetricsSnapshot = {
    timestamp: new Date().toISOString(),
    period: 'weekly',
    dora,
    behavioral,
    summary: buildMetricsSummary(dora, behavioral),
  };

  log.info('Snapshot de métricas gerado');
  return snapshot;
}

function buildMetricsSummary(dora: DORAMetrics, behavioral: BehavioralMetrics): string {
  return [
    `Deployment Frequency: ${dora.deploymentFrequency.value}/day (${dora.deploymentFrequency.trend})`,
    `Change Failure Rate: ${dora.changeFailureRate.value}% (${dora.changeFailureRate.trend})`,
    `Rubber Stamp Rate: ${behavioral.rubberStampRate.value}%`,
    `Override Rate: ${behavioral.overrideRate.value}%`,
    `Risk Trend: ${behavioral.riskTrend.current} (${behavioral.riskTrend.trend})`,
  ].join(' | ');
}
