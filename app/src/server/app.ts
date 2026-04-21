// ─────────────────────────────────────────────
// Sentinel — Configuração da Aplicação Express
// ─────────────────────────────────────────────

import express from 'express';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { webhookRouter } from './routes/webhook.js';
import { errorHandler } from './middleware/error-handler.js';
import { logger } from '../core/logger.js';

/**
 * Cria e configura a aplicação Express.
 *
 * Notas de design:
 * - Helmet adiciona headers de segurança (X-Content-Type-Options, X-Frame-Options, etc.)
 * - Rate limiting protege contra ataques de DDoS/exaustão de recursos
 * - O body bruto é preservado junto com o JSON parseado para verificação HMAC
 * - Validação HMAC é aplicada apenas nas rotas de webhook (não no health)
 * - Handler de erro é global e retorna JSON estruturado
 */
export function createApp(): express.Application {
  const app = express();

  // ── Headers de segurança ──
  app.use(helmet());

  // ── Rate limiting global para webhooks ──
  const webhookLimiter = rateLimit({
    windowMs: 60_000, // 1 minuto
    max: 120, // 120 requests por minuto
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Limite de requisições excedido',
      message: 'Tente novamente em 1 minuto',
    },
  });

  // ── Parse JSON com preservação do body bruto para HMAC ──
  app.use(
    express.json({
      limit: '256kb', // Webhooks do GitHub raramente excedem 256KB
      verify: (req: Request, _res: Response, buf: Buffer) => {
        // Armazena body bruto para verificação de assinatura HMAC
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // ── Log de requisições ──
  app.use((req: Request, _res: Response, next) => {
    logger.info(
      { method: req.method, url: req.url, ip: req.ip },
      'Requisição recebida'
    );
    next();
  });

  // ── Endpoint de saúde ──
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      service: 'sentinel-v3',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ── Rotas de webhook (com rate limiting) ──
  app.use('/webhook', webhookLimiter, webhookRouter);

  // ── Handler 404 ──
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'Não Encontrado',
      message: 'O endpoint solicitado não existe',
    });
  });

  // ── Handler global de erros ──
  app.use(errorHandler);

  return app;
}
