// ─────────────────────────────────────────────
// Sentinel — Rotas de Webhook
// ─────────────────────────────────────────────

import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateHmacSignature } from '../middleware/hmac.js';
import { eventBus } from '../../core/event-bus.js';
import { logger } from '../../core/logger.js';
import { randomUUID } from 'node:crypto';
import type { PRWebhookPayload, OverridePayload } from '../../types/events.js';

const router = Router();

// Aplica validação HMAC em todas as rotas de webhook
router.use(validateHmacSignature);

/**
 * POST /webhook/github
 *
 * Recebe eventos de webhook do GitHub e roteia para o barramento de eventos.
 * Responde imediatamente com 202 Accepted — processamento é assíncrono.
 */
router.post('/github', (req: Request, res: Response) => {
  const event = req.headers['x-github-event'] as string;
  const deliveryId = req.headers['x-github-delivery'] as string;

  if (!event) {
    res.status(400).json({ error: 'Header X-GitHub-Event ausente' });
    return;
  }

  const correlationId = deliveryId || randomUUID();

  logger.info(
    { event, deliveryId: correlationId },
    `Webhook do GitHub recebido: ${event}`
  );

  try {
    switch (event) {
      case 'pull_request':
        handlePullRequestEvent(req.body, correlationId);
        break;

      case 'issue_comment':
        handleIssueCommentEvent(req.body, correlationId);
        break;

      case 'check_suite':
      case 'check_run':
        logger.info({ event }, 'Evento de check recebido — será processado pelo Analisador de CI via fluxo de PR');
        break;

      case 'ping':
        logger.info('Ping de webhook do GitHub recebido — conexão verificada');
        break;

      default:
        logger.debug({ event }, `Tipo de evento do GitHub não tratado: ${event}`);
    }

    res.status(202).json({
      accepted: true,
      correlationId,
      event,
    });
  } catch (error) {
    logger.error({ error, event }, 'Erro ao rotear evento de webhook');
    res.status(500).json({ error: 'Falha ao processar webhook' });
  }
});

/**
 * Roteia eventos de pull_request para o barramento de eventos.
 * Apenas ações opened, synchronize (atualizado) e reopened são processadas.
 */
function handlePullRequestEvent(body: Record<string, unknown>, correlationId: string): void {
  const action = body.action as string;
  const pr = body.pull_request as Record<string, unknown>;
  const repo = body.repository as Record<string, unknown>;
  const sender = body.sender as Record<string, unknown>;

  if (!pr || !repo) {
    logger.warn('Payload de webhook pull_request mal formado — dados de PR ou repo ausentes');
    return;
  }

  const processableActions = ['opened', 'synchronize', 'reopened'];

  if (!processableActions.includes(action)) {
    logger.debug({ action }, `Ignorando ação de pull_request: ${action}`);
    return;
  }

  const owner = (repo.owner as Record<string, unknown>)?.login as string ?? '';
  const repoName = repo.name as string ?? '';

  const payload: PRWebhookPayload = {
    action,
    repository: {
      owner,
      repo: repoName,
      fullName: repo.full_name as string ?? `${owner}/${repoName}`,
    },
    pullRequest: {
      number: pr.number as number,
      title: pr.title as string ?? '',
      body: pr.body as string | null,
      author: (pr.user as Record<string, unknown>)?.login as string ?? '',
      baseBranch: (pr.base as Record<string, unknown>)?.ref as string ?? '',
      headBranch: (pr.head as Record<string, unknown>)?.ref as string ?? '',
      url: pr.url as string ?? '',
      createdAt: pr.created_at as string ?? '',
      updatedAt: pr.updated_at as string ?? '',
    },
    sender: (sender?.login as string) ?? '',
  };

  const eventName = action === 'opened' ? 'pr.opened' : 'pr.updated';

  logger.info(
    {
      correlationId,
      prNumber: payload.pullRequest.number,
      repo: payload.repository.fullName,
      action: eventName,
    },
    `Roteando evento de PR: ${eventName}`
  );

  eventBus.emit(eventName, payload);
}

/**
 * Roteia eventos de issue_comment — detecta comandos /sentinel override.
 */
function handleIssueCommentEvent(body: Record<string, unknown>, _correlationId: string): void {
  const action = body.action as string;
  if (action !== 'created') return;

  const comment = body.comment as Record<string, unknown>;
  const issue = body.issue as Record<string, unknown>;
  const repo = body.repository as Record<string, unknown>;

  if (!comment || !issue || !repo) return;

  const commentBody = (comment.body as string ?? '').trim();

  // Verifica comando de override: /sentinel override <motivo>
  const overrideMatch = commentBody.match(/^\/sentinel\s+override\s+(.+)/i);

  if (!overrideMatch) return;

  // Só processa comentários em PRs (issues com chave pull_request)
  if (!issue.pull_request) {
    logger.debug('Comando de override encontrado em issue que não é PR — ignorando');
    return;
  }

  const owner = (repo.owner as Record<string, unknown>)?.login as string ?? '';
  const repoName = repo.name as string ?? '';

  const payload: OverridePayload = {
    repository: { owner, repo: repoName },
    prNumber: issue.number as number,
    author: (comment.user as Record<string, unknown>)?.login as string ?? '',
    reason: overrideMatch[1].trim(),
    commentId: comment.id as number,
    timestamp: new Date().toISOString(),
    authorAssociation: (comment.author_association as string) ?? 'NONE',
  };

  logger.info(
    { prNumber: payload.prNumber, author: payload.author, reason: payload.reason },
    'Comando de override detectado'
  );

  eventBus.emit('override.requested', payload);
}

export { router as webhookRouter };
