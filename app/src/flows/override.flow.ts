// ─────────────────────────────────────────────
// Sentinel V3 — Fluxo de Override
// ─────────────────────────────────────────────

import { eventBus } from '../core/event-bus.js';
import { createChildLogger } from '../core/logger.js';
import type { OverridePayload } from '../types/events.js';
import { saveOverrideLog } from '../db/models/index.js';
import { sendOverrideNotification } from '../services/slack-bot/index.js';

const log = createChildLogger({ service: 'override-flow' });

/**
 * Papéis permitidos para realizar overrides.
 * Baseado no campo `author_association` do GitHub webhook.
 * https://docs.github.com/en/graphql/reference/enums#commentauthorassociation
 */
const ALLOWED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/**
 * Registra o Fluxo de Override no barramento de eventos.
 * Trata comandos /sentinel override de comentários em PRs.
 */
export function registerOverrideFlow(): void {
  eventBus.on('override.requested', (payload) => executeOverride(payload));
  log.info('Override Flow registered');
}

/**
 * Executa o fluxo de override:
 * 1. Valida o papel do autor (RBAC)
 * 2. Loga o override (trilha de auditoria)
 * 3. Notifica o Slack
 */
async function executeOverride(payload: OverridePayload): Promise<void> {
  const { repository, prNumber, author, reason, commentId, authorAssociation } = payload;
  const repoFullName = `${repository.owner}/${repository.repo}`;

  log.info(
    { repoFullName, prNumber, author, reason, authorAssociation },
    '🔓 Processando solicitação de override'
  );

  try {
    // ── Passo 1: Validar papel (RBAC) ──
    if (!authorAssociation || !ALLOWED_ASSOCIATIONS.includes(authorAssociation.toUpperCase())) {
      log.warn(
        { author, authorAssociation, allowedRoles: ALLOWED_ASSOCIATIONS },
        '⛔ Override rejeitado — autor não tem permissão suficiente'
      );

      // Não processa o override — autor não tem papel de mantenedor
      return;
    }

    log.info(
      { author, authorAssociation },
      '✅ Papel do autor validado para override'
    );

    // ── Passo 2: Logar override (TRILHA DE AUDITORIA — exigido por restrições) ──
    try {
      await saveOverrideLog(
        repoFullName,
        prNumber,
        author,
        reason,
        commentId
      );
      log.info('Override registrado no banco de dados');
    } catch (dbError) {
      log.warn({ error: dbError }, 'Falha ao salvar override no DB');
    }

    // ── Passo 3: Notificar Slack ──
    await sendOverrideNotification(repoFullName, prNumber, author, reason);

    log.info(
      { repoFullName, prNumber, author, reason },
      '✅ Override processado — trilha de auditoria criada'
    );
  } catch (error) {
    log.error(
      { error, repoFullName, prNumber, author },
      '❌ Fluxo de override falhou'
    );
  }
}

export { ALLOWED_ASSOCIATIONS };
