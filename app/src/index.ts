// ─────────────────────────────────────────────
// Sentinel — Ponto de Entrada da Aplicação
// ─────────────────────────────────────────────

import { createApp } from './server/app.js';
import { config } from './config/index.js';
import { logger } from './core/logger.js';
import { eventBus } from './core/event-bus.js';

// Fluxos
import { registerPRAnalysisFlow } from './flows/pr-analysis.flow.js';
import { registerOverrideFlow } from './flows/override.flow.js';
import { registerWeeklyReportFlow } from './flows/weekly-report.flow.js';

// Serviços
import { initializeScheduler, stopScheduler } from './services/scheduler/index.js';
import { initializeSlackBot } from './services/slack-bot/index.js';

// Banco de dados
import { runMigrations, closeDatabase } from './db/connection.js';

/**
 * Contador de operações ativas para graceful shutdown.
 * Garante que análises em andamento terminem antes de encerrar.
 */
let activeOperations = 0;

export function incrementActiveOps(): void { activeOperations++; }
export function decrementActiveOps(): void { activeOperations--; }
export function getActiveOps(): number { return activeOperations; }

/**
 * Sequência de inicialização:
 * 1. Executar migrações do banco de dados
 * 2. Inicializar bot do Slack
 * 3. Registrar fluxos no barramento de eventos
 * 4. Inicializar agendador
 * 5. Criar aplicação Express
 * 6. Iniciar servidor HTTP
 */
async function main(): Promise<void> {
  logger.info('─────────────────────────────────────────────');
  logger.info('  🛡️  Sentinel — Guardrail Inteligente de PR');
  logger.info('─────────────────────────────────────────────');
  logger.info({ env: config.nodeEnv, port: config.port }, 'Iniciando...');

  // ── Passo 1: Banco de dados ──
  try {
    await runMigrations();
    logger.info('Banco de dados pronto');
  } catch (error) {
    logger.warn({ error }, 'Inicialização do banco falhou — rodando sem persistência');
  }

  // ── Passo 2: Bot do Slack ──
  await initializeSlackBot();

  // ── Passo 3: Registrar fluxos ──
  registerPRAnalysisFlow();
  registerOverrideFlow();
  registerWeeklyReportFlow();
  logger.info('Todos os fluxos registrados');

  // ── Passo 4: Agendador ──
  initializeScheduler();

  // ── Passo 5: Criar aplicação Express ──
  const app = createApp();

  // ── Passo 6: Iniciar servidor HTTP ──
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, env: config.nodeEnv },
      `🛡️  Sentinel escutando na porta ${config.port}`
    );
    logger.info(`   Saúde:   http://localhost:${config.port}/health`);
    logger.info(`   Webhook: http://localhost:${config.port}/webhook/github`);
    logger.info('');
    logger.info({ handlers: eventBus.diagnostics() }, 'Handlers do barramento de eventos');
  });

  // ── Desligamento gracioso ──
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Sinal de desligamento recebido');

    stopScheduler();

    // Espera operações ativas terminarem (máximo 15s)
    if (activeOperations > 0) {
      logger.info(
        { activeOperations },
        'Aguardando operações ativas terminarem...'
      );

      const waitStart = Date.now();
      const maxWait = 15_000;

      while (activeOperations > 0 && Date.now() - waitStart < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (activeOperations > 0) {
        logger.warn(
          { activeOperations },
          'Timeout esperando operações ativas — forçando encerramento'
        );
      }
    }

    server.close(async () => {
      logger.info('Servidor HTTP encerrado');
      eventBus.removeAllListeners();
      logger.info('Barramento de eventos limpo');

      await closeDatabase();

      logger.info('🛡️  Sentinel desligado graciosamente');
      process.exit(0);
    });

    // Forçar saída após 20s se o desligamento gracioso travar
    setTimeout(() => {
      logger.error('Desligamento forçado após timeout');
      process.exit(1);
    }, 20_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Redes de segurança ──
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Rejeição de promise não tratada');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Exceção não capturada — desligando');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Falha ao iniciar o Sentinel');
  process.exit(1);
});
