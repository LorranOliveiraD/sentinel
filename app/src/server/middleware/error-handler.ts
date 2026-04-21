// ─────────────────────────────────────────────
// Sentinel V3 — Middleware Global de Tratamento de Erros
// ─────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../core/logger.js';
import { config } from '../../config/index.js';

/**
 * Handler global de erros do Express.
 * Captura todos os erros não tratados, loga e retorna resposta JSON estruturada.
 *
 * Nota: O Express requer a assinatura com 4 parâmetros para reconhecer como handler de erro.
 *
 * Segurança: Usa config.nodeEnv ao invés de process.env.NODE_ENV para
 * garantir que stack traces nunca vazem em produção, mesmo que a variável
 * de ambiente seja sobrescrita em runtime.
 */
export function errorHandler(
  err: Error & { statusCode?: number },
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error(
      { error: err, method: req.method, url: req.url },
      'Erro não tratado no servidor'
    );
  } else {
    logger.warn(
      { error: err.message, method: req.method, url: req.url, statusCode },
      'Erro do cliente'
    );
  }

  res.status(statusCode).json({
    error: isServerError ? 'Erro Interno do Servidor' : err.message,
    message: isServerError
      ? 'Ocorreu um erro inesperado. Tente novamente mais tarde.'
      : err.message,
    ...(config.nodeEnv === 'development' && {
      stack: err.stack,
    }),
  });
}
