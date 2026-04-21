// ─────────────────────────────────────────────
// Sentinel — Carregador de Configuração da Aplicação
// ─────────────────────────────────────────────

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../types/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carrega .env a partir da raiz do app (dois níveis acima de src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Lê uma variável de ambiente, retornando um valor padrão se não definida.
 * Lança erro se `required` é true e a variável está ausente.
 */
function env(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`[config] Variável de ambiente obrigatória ausente: ${key}`);
  }
  return value;
}

/**
 * Constrói a configuração da aplicação a partir de variáveis de ambiente.
 * Valida chaves obrigatórias de forma antecipada para falhar rápido na inicialização.
 */
function loadConfig(): AppConfig {
  const nodeEnv = env('NODE_ENV', 'development') as AppConfig['nodeEnv'];
  const isProduction = nodeEnv === 'production';

  return {
    nodeEnv,
    port: parseInt(env('PORT', '3000'), 10),
    logLevel: env('LOG_LEVEL', 'info') as AppConfig['logLevel'],

    // GitHub — obrigatório em produção, opcional em dev para testes
    githubWebhookSecret: env('GITHUB_WEBHOOK_SECRET', isProduction ? undefined : 'dev-secret'),
    githubToken: env('GITHUB_TOKEN', isProduction ? undefined : ''),

    // Anthropic — obrigatório em produção
    anthropicApiKey: env('ANTHROPIC_API_KEY', isProduction ? undefined : ''),

    // Slack — obrigatório em produção
    slackBotToken: env('SLACK_BOT_TOKEN', isProduction ? undefined : ''),
    slackSigningSecret: env('SLACK_SIGNING_SECRET', isProduction ? undefined : ''),
    slackChannelAlerts: env('SLACK_CHANNEL_ALERTS', 'sentinel-alerts'),
    slackChannelReports: env('SLACK_CHANNEL_REPORTS', 'sentinel-reports'),

    // Banco de dados
    databaseUrl: env('DATABASE_URL', isProduction ? undefined : 'postgresql://localhost:5432/sentinel_v3'),
    sqlitePath: env('SQLITE_PATH', './data/sentinel.db'),

    // Agendador
    weeklyReportCron: env('WEEKLY_REPORT_CRON', '0 9 * * 1'),

    // Google
    googleApiKey: env('GOOGLE_API_KEY', ''),
  };
}

/** Instância singleton da configuração */
export const config: AppConfig = loadConfig();

/**
 * Verifica se está rodando em modo desenvolvimento.
 */
export function isDevelopment(): boolean {
  return config.nodeEnv === 'development';
}

/**
 * Verifica se está rodando em modo produção.
 */
export function isProduction(): boolean {
  return config.nodeEnv === 'production';
}

/**
 * Verifica se está rodando em modo teste.
 */
export function isTest(): boolean {
  return config.nodeEnv === 'test';
}
