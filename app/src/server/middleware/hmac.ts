// ─────────────────────────────────────────────
// Sentinel V3 — Middleware de Validação de Assinatura HMAC
// ─────────────────────────────────────────────

import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config/index.js';
import { logger } from '../../core/logger.js';

/** Tipo de request estendido com buffer do body bruto */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Middleware que valida assinaturas HMAC-SHA256 de webhooks do GitHub.
 *
 * O GitHub envia:
 *   X-Hub-Signature-256: sha256=<hex_digest>
 *
 * Nós computamos HMAC-SHA256 sobre o body bruto da request usando nosso segredo
 * de webhook e comparamos com igualdade em tempo constante para prevenir ataques de timing.
 */
export function validateHmacSignature(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction
): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  if (!signature) {
    logger.warn({ ip: req.ip }, 'Request de webhook sem header X-Hub-Signature-256');
    res.status(401).json({
      error: 'Não autorizado',
      message: 'Header de assinatura ausente',
    });
    return;
  }

  if (!req.rawBody) {
    logger.error('Body bruto não disponível para verificação HMAC — verifique a configuração do body parser');
    res.status(500).json({
      error: 'Erro Interno do Servidor',
      message: 'Não foi possível verificar a assinatura',
    });
    return;
  }

  const expected = computeSignature(req.rawBody, config.githubWebhookSecret);

  if (!secureCompare(signature, expected)) {
    logger.warn(
      { ip: req.ip },
      'Assinatura HMAC do webhook não confere — rejeitando request'
    );
    res.status(401).json({
      error: 'Não autorizado',
      message: 'Assinatura inválida',
    });
    return;
  }

  logger.debug('Assinatura HMAC validada com sucesso');
  next();
}

/**
 * Computa a assinatura HMAC-SHA256 no formato que o GitHub usa: sha256=<hex>
 */
function computeSignature(body: Buffer, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Comparação de strings em tempo constante para prevenir ataques de timing.
 *
 * Corrigido: Quando os comprimentos diferem, realizamos uma comparação dummy
 * para manter o tempo de execução constante, impedindo que um atacante
 * descubra o comprimento esperado via timing.
 */
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Realiza comparação dummy para manter tempo constante
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

// Exporta para testes
export { computeSignature, secureCompare };
