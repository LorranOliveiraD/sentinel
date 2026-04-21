// ─────────────────────────────────────────────
import { eventBus } from '../core/event-bus.js';
import { createChildLogger } from '../core/logger.js';
import { generateMetricsSnapshot } from '../services/metrics-engine/index.js';
import { generateWeeklyReport } from '../services/ai-service/index.js';
import { postWeeklyReport } from '../services/slack-bot/index.js';
import { saveMetricSnapshot, getAggregatedMetricsData, getRepoFailureRates } from '../db/models/index.js';

const log = createChildLogger({ service: 'weekly-report-flow' });

/**
 * Registra o Fluxo de Relatório Semanal no barramento de eventos.
 * Acionado pelo serviço agendador.
 */
export function registerWeeklyReportFlow(): void {
  eventBus.on('scheduler.weekly-report', () => executeWeeklyReport());
  log.info('Weekly Report Flow registered');
}

/**
 * Executa o fluxo de relatório semanal:
 * 1. Calcula métricas
 * 2. Coleta histórico agregado
 * 3. Gera relatório por IA
 * 4. Posta no Slack
 * 5. Armazena snapshot no DB
 */
async function executeWeeklyReport(): Promise<void> {
  log.info('📊 Iniciando geração de relatório semanal');

  try {
    // ── Passo 1: Calcular métricas ──
    const aggregatedData = await getAggregatedMetricsData();
    const repoFailureRates = await getRepoFailureRates();

    const metricsSnapshot = generateMetricsSnapshot(aggregatedData, repoFailureRates);

    // ── Passo 2: Coletar histórico ──
    const history = {
      developers: {
        topReviewer: aggregatedData.topReviewer?.username ?? 'N/A',
        totalAnalyses: aggregatedData.totalAnalyses,
        avgRiskScore: aggregatedData.avgRisk,
        totalOverrides: aggregatedData.totalOverrides,
      },
      repositories: repoFailureRates.map((r) => ({
        repo: r.repo,
        totalAnalyses: r.total,
        failures: r.failures,
      })),
    };

    // ── Passo 3: Gerar relatório por IA ──
    log.info('Gerando relatório por IA');

    const metrics = {
      dora: metricsSnapshot.dora,
      behavioral: metricsSnapshot.behavioral,
    };

    const aiReport = await generateWeeklyReport(metrics, history);

    // ── Passo 4: Postar no Slack ──
    await postWeeklyReport(aiReport);

    // ── Passo 5: Armazenar snapshot ──
    try {
      await saveMetricSnapshot(
        'weekly',
        metricsSnapshot.dora,
        metricsSnapshot.behavioral,
        metricsSnapshot.summary,
        aiReport
      );
      log.info('Snapshot de métricas salvo no DB');
    } catch (dbError) {
      log.warn({ error: dbError }, 'Falha ao salvar snapshot de métricas no DB');
    }

    log.info('✅ Relatório semanal gerado e postado');
  } catch (error) {
    log.error({ error }, '❌ Falha no fluxo de relatório semanal');
  }
}
