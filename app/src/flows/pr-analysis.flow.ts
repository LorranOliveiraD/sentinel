// ─────────────────────────────────────────────
// Sentinel V3 — Fluxo de Análise de PR
// ─────────────────────────────────────────────
// Orquestra: Webhook → Analisadores → Contexto → Política → Ação
// ─────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { eventBus } from '../core/event-bus.js';
import { createChildLogger } from '../core/logger.js';
import type { PRWebhookPayload } from '../types/events.js';
import type { RuleInput } from '../types/policy.js';
import { SENTINEL_RC_DEFAULTS } from '../types/config.js';

// Serviços
import { analyzePRFiles } from '../services/pr-analyzer/index.js';
import { analyzeCIPipeline, type CIAnalysisResult } from '../services/ci-analyzer/index.js';
import { analyzeDependencies } from '../services/dep-analyzer/index.js';
import { buildContext } from '../services/context-builder/index.js';
import { evaluatePolicy } from '../services/policy-engine/index.js';
import { explainFindings } from '../services/ai-service/index.js';
import {
  fetchPRFiles,
  fetchCheckRuns,
  fetchPRData,
  fetchFileContent,
  postComment,
} from '../services/github-integration/index.js';
import { sendBlockAlert, sendWarningAlert } from '../services/slack-bot/index.js';
import { savePRAnalysis, getAuthorStats } from '../db/models/index.js';
import { parseSentinelRcContent } from '../config/sentinel-rc.js';

const log = createChildLogger({ service: 'pr-analysis-flow' });

/**
 * Registra o Fluxo de Análise de PR no barramento de eventos.
 * Este é o pipeline principal que processa todos os eventos de PR.
 */
export function registerPRAnalysisFlow(): void {
  // Trata PRs abertos e atualizados com o mesmo fluxo
  eventBus.on('pr.opened', (payload) => executePRAnalysis(payload));
  eventBus.on('pr.updated', (payload) => executePRAnalysis(payload));

  log.info('PR Analysis Flow registered');
}

/**
 * Executa o pipeline completo de análise de PR.
 *
 * Passos:
 * 1. Busca dados do PR + arquivos do GitHub
 * 2. Executa analisadores em paralelo (PR, CI, Dep)
 * 3. Carrega configuração do repositório
 * 4. Obtém histórico do autor
 * 5. Constrói contexto para o Motor de Política
 * 6. Motor de Política avalia (DETERMINÍSTICO)
 * 7. Se bloqueado → gera explicação por IA
 * 8. Posta comentário no GitHub
 * 9. Envia alertas no Slack se necessário
 * 10. Armazena resultados no banco de dados
 */
async function executePRAnalysis(payload: PRWebhookPayload): Promise<void> {
  const correlationId = randomUUID();
  const { repository, pullRequest } = payload;
  const repo = { owner: repository.owner, repo: repository.repo };

  log.info(
    { correlationId, repo: repository.fullName, pr: pullRequest.number },
    '🚀 Iniciando fluxo de análise de PR'
  );

  try {
    // ── Passo 1: Buscar dados do GitHub ──
    log.info({ correlationId }, 'Passo 1/10: Buscando dados do PR no GitHub');

    const [prData, prFiles] = await Promise.all([
      fetchPRData(repo, pullRequest.number),
      fetchPRFiles(repo, pullRequest.number),
    ]);

    // ── Passo 2: Executar analisadores ──
    log.info({ correlationId }, 'Passo 2/10: Executando analisadores');

    const [prAnalysis, checkRuns, depAnalysis] = await Promise.all([
      Promise.resolve(analyzePRFiles(prFiles)),
      fetchCheckRuns(repo, prData.headSha),
      analyzeDependencies(
        prFiles.map((f) => f.filename),
        (path) => fetchFileContent(repo, path, prData.headBranch)
      ),
    ]);

    const ciAnalysis: CIAnalysisResult = analyzeCIPipeline(checkRuns);

    // ── Passo 3: Carregar configuração do repositório ──
    log.info({ correlationId }, 'Passo 3/10: Carregando configuração do repo');

    let repoConfig = SENTINEL_RC_DEFAULTS;
    try {
      const rcContent = await fetchFileContent(repo, '.sentinelrc.yml', prData.headBranch);
      if (rcContent) {
        repoConfig = parseSentinelRcContent(rcContent);
      }
    } catch {
      log.debug('Nenhum .sentinelrc.yml encontrado no repo — usando padrões');
    }

    // ── Passo 4: Obter histórico do autor ──
    log.info({ correlationId }, 'Passo 4/10: Obtendo histórico do autor');

    const authorHistory = await getAuthorStats(pullRequest.author);

    // ── Passo 5: Construir entrada para o Motor de Política ──
    log.info({ correlationId }, 'Passo 5/10: Construindo contexto');

    const ruleInput: RuleInput = {
      prAnalysis: {
        filesChanged: prAnalysis.filesChanged.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
          isTestFile: f.isTestFile,
          isDependencyFile: f.isDependencyFile,
        })),
        totalLinesAdded: prAnalysis.totalLinesAdded,
        totalLinesRemoved: prAnalysis.totalLinesRemoved,
        totalFilesChanged: prAnalysis.totalFilesChanged,
      },
      ciAnalysis: {
        overallStatus: ciAnalysis.overallStatus,
        failedChecks: ciAnalysis.failedChecks,
        pendingChecks: ciAnalysis.pendingChecks,
      },
      depAnalysis: {
        dependencyFilesChanged: depAnalysis.dependencyFilesChanged,
        vulnerabilities: depAnalysis.vulnerabilities.map((v) => ({
          id: v.id,
          package: v.package,
          severity: v.severity,
          summary: v.summary,
        })),
      },
      config: {
        riskScoreWarn: repoConfig.riskScoreWarn,
        riskScoreBlock: repoConfig.riskScoreBlock,
        minTestCoverage: repoConfig.minTestCoverage,
        largePRLines: repoConfig.largePRLines,
      },
    };

    // ── Passo 6: Motor de Política (DECISÃO DETERMINÍSTICA) ──
    log.info({ correlationId }, 'Passo 6/10: Avaliando política (determinístico)');

    const decision = evaluatePolicy(ruleInput, repoConfig, authorHistory.historicalRiskAvg);

    // ── Passo 7: Explicação por IA (apenas para bloqueios) ──
    let aiExplanation: string | undefined;

    if (decision.action === 'block') {
      log.info({ correlationId }, 'Passo 7/10: Gerando explicação por IA (decisão de bloqueio)');

      const contextPayload = buildContext({
        correlationId,
        repository: repo,
        prNumber: pullRequest.number,
        prTitle: pullRequest.title,
        prAuthor: pullRequest.author,
        prAnalysis,
        ciAnalysis,
        depAnalysis,
        findings: decision.findings,
        authorHistory,
      });

      aiExplanation = await explainFindings(contextPayload.context, decision);
      decision.explanation = aiExplanation;
    }

    // ── Passo 8: Postar no GitHub ──
    log.info({ correlationId }, 'Passo 8/10: Postando comentário no GitHub');

    await postComment(repo, pullRequest.number, decision, aiExplanation);

    // ── Passo 9: Notificações no Slack ──
    log.info({ correlationId }, 'Passo 9/10: Enviando notificações');

    if (decision.action === 'block') {
      await sendBlockAlert(
        repository.fullName,
        pullRequest.number,
        pullRequest.title,
        pullRequest.author,
        decision
      );
    } else if (decision.action === 'warn') {
      await sendWarningAlert(
        repository.fullName,
        pullRequest.number,
        pullRequest.title,
        decision
      );
    }

    // ── Passo 10: Armazenando resultados ──
    log.info({ correlationId }, 'Passo 10/10: Armazenando resultados');

    try {
      await savePRAnalysis({
        correlationId,
        repo,
        prNumber: pullRequest.number,
        prTitle: pullRequest.title,
        prAuthor: pullRequest.author,
        decision,
        linesAdded: prAnalysis.totalLinesAdded,
        linesRemoved: prAnalysis.totalLinesRemoved,
        filesChanged: prAnalysis.totalFilesChanged,
        aiExplanation,
      });
    } catch (dbError) {
      log.warn({ error: dbError }, 'Falha ao salvar no DB');
    }

    // ── Emitir evento de conclusão ──
    eventBus.emit('policy.decided', {
      correlationId,
      repository: repo,
      prNumber: pullRequest.number,
      decision,
    });

    log.info(
      {
        correlationId,
        action: decision.action,
        riskScore: decision.riskScore.total,
        findings: decision.findings.length,
        repo: repository.fullName,
        pr: pullRequest.number,
      },
      `✅ Análise de PR concluída: ${decision.action.toUpperCase()} (score: ${decision.riskScore.total})`
    );
  } catch (error) {
    log.error(
      { error, correlationId, repo: repository.fullName, pr: pullRequest.number },
      '❌ Falha no fluxo de análise de PR'
    );
  }
}
