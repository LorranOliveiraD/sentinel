// ─────────────────────────────────────────────
// Sentinel — Serviço do Bot do Slack
// ─────────────────────────────────────────────

import { config } from '../../config/index.js';
import { createChildLogger } from '../../core/logger.js';
import type { PolicyDecision } from '../../types/policy.js';

const log = createChildLogger({ service: 'slack-bot' });

/** App Slack Bolt (inicializado preguiçosamente) */
let slackApp: SlackAppLike | null = null;

/** Interface mínima do app Slack para evitar acoplamento forte com o Bolt no momento da importação */
interface SlackAppLike {
  client: {
    chat: {
      postMessage: (args: {
        channel: string;
        text: string;
        blocks?: unknown[];
      }) => Promise<unknown>;
    };
  };
  start: () => Promise<void>;
}

/**
 * Inicializa o app Slack Bolt.
 * Chamado durante a inicialização — apenas se os tokens do Slack estiverem configurados.
 */
export async function initializeSlackBot(): Promise<void> {
  if (!config.slackBotToken || !config.slackSigningSecret) {
    log.warn('Tokens do Slack não configurados — integração com Slack desativada');
    return;
  }

  try {
    // Dynamic import to avoid breaking when Slack is not configured
    const { App } = await import('@slack/bolt');

    slackApp = new App({
      token: config.slackBotToken,
      signingSecret: config.slackSigningSecret,
      socketMode: false,
    }) as unknown as SlackAppLike;

    log.info('Bot do Slack inicializado');
  } catch (error) {
    log.error({ error }, 'Falha ao inicializar o bot do Slack');
  }
}

/**
 * Envia um alerta de bloqueio para o canal de alertas configurado.
 * Chamado quando um PR é bloqueado pelo Motor de Política.
 */
export async function sendBlockAlert(
  repo: string,
  prNumber: number,
  prTitle: string,
  prAuthor: string,
  decision: PolicyDecision
): Promise<void> {
  if (!slackApp) {
    log.debug('Slack não inicializado — pulando alerta de bloqueio');
    return;
  }

  const blocks = buildBlockAlertBlocks(repo, prNumber, prTitle, prAuthor, decision);

  try {
    await slackApp.client.chat.postMessage({
      channel: config.slackChannelAlerts,
      text: `🚫 PR #${prNumber} bloqueado em ${repo} — Score de Risco: ${decision.riskScore.total}/100`,
      blocks,
    });

    log.info({ repo, prNumber }, 'Alerta de bloqueio enviado para o Slack');
  } catch (error) {
    log.error({ error }, 'Falha ao enviar alerta de bloqueio para o Slack');
  }
}

/**
 * Envia uma notificação de aviso para o Slack.
 */
export async function sendWarningAlert(
  repo: string,
  prNumber: number,
  prTitle: string,
  decision: PolicyDecision
): Promise<void> {
  if (!slackApp) {
    log.debug('Slack não inicializado — pulando alerta de aviso');
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
      channel: config.slackChannelAlerts,
      text: `⚠️ PR #${prNumber} aviso em ${repo} — Score de Risco: ${decision.riskScore.total}/100\n*${prTitle}*`,
    });

    log.info({ repo, prNumber }, 'Alerta de aviso enviado para o Slack');
  } catch (error) {
    log.error({ error }, 'Falha ao enviar alerta de aviso para o Slack');
  }
}

/**
 * Posta um relatório semanal no canal de relatórios configurado.
 */
export async function postWeeklyReport(report: string): Promise<void> {
  if (!slackApp) {
    log.debug('Slack não inicializado — pulando relatório semanal');
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
      channel: config.slackChannelReports,
      text: report,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: report.substring(0, 3000), // Limite de blocos do Slack
          },
        },
      ],
    });

    log.info('Relatório semanal postado no Slack');
  } catch (error) {
    log.error({ error }, 'Falha ao postar relatório semanal no Slack');
  }
}

/**
 * Envia uma notificação de override para o Slack.
 */
export async function sendOverrideNotification(
  repo: string,
  prNumber: number,
  author: string,
  reason: string
): Promise<void> {
  if (!slackApp) {
    log.debug('Slack não inicializado — pulando notificação de override');
    return;
  }

  try {
    await slackApp.client.chat.postMessage({
      channel: config.slackChannelAlerts,
      text: `🔓 Override no PR #${prNumber} em ${repo} por @${author}\nMotivo: ${reason}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔓 *Override Registrado*\n\n*Repositório:* ${repo}\n*PR:* #${prNumber}\n*Autor:* @${author}\n*Motivo:* ${reason}\n*Data/Hora:* ${new Date().toISOString()}`,
          },
        },
      ],
    });

    log.info({ repo, prNumber, author }, 'Notificação de override enviada para o Slack');
  } catch (error) {
    log.error({ error }, 'Falha ao enviar notificação de override');
  }
}

// ── Construção de Blocos ──

function buildBlockAlertBlocks(
  repo: string,
  prNumber: number,
  prTitle: string,
  prAuthor: string,
  decision: PolicyDecision
): unknown[] {
  const topFindings = decision.findings
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🚫 PR Bloqueado pelo Sentinel' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Repositório:*\n${repo}` },
        { type: 'mrkdwn', text: `*PR:*\n#${prNumber}` },
        { type: 'mrkdwn', text: `*Autor:*\n@${prAuthor}` },
        { type: 'mrkdwn', text: `*Score de Risco:*\n${decision.riskScore.total}/100` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Título:* ${prTitle}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Principais Achados:*\n${topFindings.map((f) => `• [${f.severity.toUpperCase()}] ${f.title}`).join('\n')}`,
      },
    },
    { type: 'divider' },
  ];
}
