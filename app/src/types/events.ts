// ─────────────────────────────────────────────
// Sentinel V3 — Definições de Tipos de Eventos
// ─────────────────────────────────────────────

import type { PRAnalysisResult } from './github.js';
import type { PolicyDecision, Finding } from './policy.js';

/**
 * Todos os eventos emitidos no barramento interno de eventos.
 * Cada chave é o nome do evento; o valor é o tipo do payload.
 */
export interface SentinelEvents {
  // ── Gatilhos de webhook ──
  'pr.opened': PRWebhookPayload;
  'pr.updated': PRWebhookPayload;

  // ── Saídas dos analisadores ──
  'analysis.pr.complete': PRAnalysisComplete;
  'analysis.ci.complete': CIAnalysisComplete;
  'analysis.dep.complete': DepAnalysisComplete;

  // ── Contexto ──
  'context.ready': ContextReadyPayload;

  // ── Decisões de política ──
  'policy.decided': PolicyDecidedPayload;

  // ── Overrides ──
  'override.requested': OverridePayload;

  // ── Gatilhos do agendador ──
  'scheduler.weekly-report': WeeklyReportTrigger;
}

/** Payload recebido do webhook do GitHub para eventos de PR */
export interface PRWebhookPayload {
  action: string;
  installationId?: number;
  repository: {
    owner: string;
    repo: string;
    fullName: string;
  };
  pullRequest: {
    number: number;
    title: string;
    body: string | null;
    author: string;
    baseBranch: string;
    headBranch: string;
    url: string;
    createdAt: string;
    updatedAt: string;
  };
  sender: string;
}

/** Saída do Analisador de PR */
export interface PRAnalysisComplete {
  correlationId: string;
  repository: { owner: string; repo: string };
  prNumber: number;
  result: PRAnalysisResult;
}

/** Saída do Analisador de CI */
export interface CIAnalysisComplete {
  correlationId: string;
  repository: { owner: string; repo: string };
  prNumber: number;
  result: {
    overallStatus: 'success' | 'failure' | 'pending' | 'neutral';
    checkRuns: Array<{
      name: string;
      status: string;
      conclusion: string | null;
    }>;
    failedChecks: string[];
    pendingChecks: string[];
  };
}

/** Saída do Analisador de Dependências */
export interface DepAnalysisComplete {
  correlationId: string;
  repository: { owner: string; repo: string };
  prNumber: number;
  result: {
    dependencyFilesChanged: string[];
    vulnerabilities: Array<{
      id: string;
      package: string;
      severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
      summary: string;
      affectedVersions: string;
      fixedVersions: string | null;
    }>;
  };
}

/** Contexto agregado para o Motor de Política / Claude */
export interface ContextReadyPayload {
  correlationId: string;
  repository: { owner: string; repo: string };
  prNumber: number;
  context: {
    pr: {
      title: string;
      author: string;
      linesAdded: number;
      linesRemoved: number;
      filesChanged: number;
    };
    author: {
      username: string;
      historicalRiskAvg: number | null;
      overrideCount: number;
    };
    findings: {
      secrets: number;
      cves: { critical: number; high: number; moderate: number; low: number };
      testsIncluded: boolean;
      pipelineHealthy: boolean;
      prSize: 'small' | 'medium' | 'large';
    };
    rawFindings: Finding[];
  };
  tokenEstimate: number;
}

/** Saída de decisão do Motor de Política */
export interface PolicyDecidedPayload {
  correlationId: string;
  repository: { owner: string; repo: string };
  prNumber: number;
  decision: PolicyDecision;
}

/** Comando de override vindo de comentário no PR */
export interface OverridePayload {
  repository: { owner: string; repo: string };
  prNumber: number;
  author: string;
  reason: string;
  commentId: number;
  timestamp: string;
  /** Associação do autor com o repositório (OWNER, MEMBER, COLLABORATOR, etc.) */
  authorAssociation: string;
}

/** Gatilho de relatório semanal */
export interface WeeklyReportTrigger {
  triggeredAt: string;
  repositories?: Array<{ owner: string; repo: string }>;
}

/** Tipo união de todos os nomes de eventos */
export type SentinelEventName = keyof SentinelEvents;
