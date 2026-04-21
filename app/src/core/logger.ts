// ─────────────────────────────────────────────
// Sentinel V3 — Logger Estruturado (Pino)
// ─────────────────────────────────────────────

import pino from 'pino';

const logLevel = process.env.LOG_LEVEL ?? 'info';
const nodeEnv = process.env.NODE_ENV ?? 'development';

/**
 * Logger estruturado usando Pino.
 *
 * - Desenvolvimento: saída formatada com cores para legibilidade
 * - Produção: saída JSON para agregação de logs (ELK, CloudWatch, etc.)
 */
export const logger = pino({
  name: 'sentinel-v3',
  level: logLevel,

  // Formatação legível em desenvolvimento
  ...(nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),

  // Campos base incluídos em cada linha de log
  base: {
    service: 'sentinel-v3',
    env: nodeEnv,
  },

  // Serializadores personalizados para objetos comuns
  serializers: {
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  // Ocultar campos sensíveis dos logs
  redact: {
    paths: [
      'githubToken',
      'anthropicApiKey',
      'googleApiKey',
      'slackBotToken',
      'slackSigningSecret',
      'githubWebhookSecret',
      'headers.authorization',
      'headers["x-hub-signature-256"]',
    ],
    censor: '[OCULTADO]',
  },
});

/**
 * Cria um logger filho com campos contextuais.
 * Use nos serviços para marcar logs automaticamente com nome do serviço, correlationId, etc.
 */
export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
