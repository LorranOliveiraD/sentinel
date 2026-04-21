// ─────────────────────────────────────────────
// Sentinel V3 — Serviço Agendador (Scheduler)
// ─────────────────────────────────────────────

import cron from 'node-cron';
import { config } from '../../config/index.js';
import { eventBus } from '../../core/event-bus.js';
import { createChildLogger } from '../../core/logger.js';

const log = createChildLogger({ service: 'scheduler' });

/** Tarefas cron ativas para limpeza */
const jobs: cron.ScheduledTask[] = [];

/**
 * Inicializa todas as tarefas agendadas.
 */
export function initializeScheduler(): void {
  log.info('Initializing scheduler');

  // ── Relatório Semanal ──
  const weeklyJob = cron.schedule(config.weeklyReportCron, () => {
    log.info('Disparando relatório semanal');
    eventBus.emit('scheduler.weekly-report', {
      triggeredAt: new Date().toISOString(),
    });
  });

  jobs.push(weeklyJob);

  log.info(
    { cronExpression: config.weeklyReportCron },
    'Relatório semanal agendado'
  );

  log.info(`Agendador inicializado com ${jobs.length} tarefa(s)`);
}

/**
 * Interrompe todas as tarefas agendadas.
 */
export function stopScheduler(): void {
  for (const job of jobs) {
    job.stop();
  }
  jobs.length = 0;
  log.info('Agendador parado');
}
