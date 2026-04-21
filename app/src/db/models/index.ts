// ─────────────────────────────────────────────
// Sentinel — Modelos do Banco de Dados
// ─────────────────────────────────────────────

import { getDatabase } from '../connection.js';
import { createChildLogger } from '../../core/logger.js';
import type { PolicyDecision } from '../../types/policy.js';

const log = createChildLogger({ service: 'db-models' });

// ── Modelo de Análise de PR ──

export interface PRAnalysisRecord {
  id?: number;
  correlation_id: string;
  repo_owner: string;
  repo_name: string;
  repo_full_name: string;
  pr_number: number;
  pr_title: string;
  pr_author: string;
  action: string;
  risk_score: number;
  risk_breakdown: string; // JSON
  findings: string; // JSON
  rule_results: string; // JSON
  summary: string | null;
  ai_explanation: string | null;
  lines_added: number;
  lines_removed: number;
  files_changed: number;
  created_at?: string;
  updated_at?: string;
}

/** Parâmetros para salvar uma análise de PR */
export interface SavePRAnalysisParams {
  correlationId: string;
  repo: { owner: string; repo: string };
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  decision: PolicyDecision;
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
  aiExplanation?: string;
}

export async function savePRAnalysis(params: SavePRAnalysisParams): Promise<number> {
  const {
    correlationId, repo, prNumber, prTitle, prAuthor,
    decision, linesAdded, linesRemoved, filesChanged, aiExplanation,
  } = params;

  const db = getDatabase();

  const [id] = await db('pr_analyses').insert({
    correlation_id: correlationId,
    repo_owner: repo.owner,
    repo_name: repo.repo,
    repo_full_name: `${repo.owner}/${repo.repo}`,
    pr_number: prNumber,
    pr_title: prTitle,
    pr_author: prAuthor,
    action: decision.action,
    risk_score: decision.riskScore.total,
    risk_breakdown: JSON.stringify(decision.riskScore.breakdown),
    findings: JSON.stringify(decision.findings),
    rule_results: JSON.stringify(decision.ruleResults),
    summary: decision.summary,
    ai_explanation: aiExplanation ?? null,
    lines_added: linesAdded,
    lines_removed: linesRemoved,
    files_changed: filesChanged,
  });

  log.info({ id, correlationId, prNumber }, 'Análise de PR salva');
  return id as number;
}

export async function getPRAnalysesByRepo(
  repoFullName: string,
  limit = 50
): Promise<PRAnalysisRecord[]> {
  const db = getDatabase();
  return db('pr_analyses')
    .where('repo_full_name', repoFullName)
    .orderBy('created_at', 'desc')
    .limit(limit);
}

// ── Modelo de Log de Override ──

export interface OverrideLogRecord {
  id?: number;
  repo_full_name: string;
  pr_number: number;
  author: string;
  reason: string;
  comment_id: number | null;
  original_risk_score: number | null;
  original_action: string | null;
  created_at?: string;
}

export async function saveOverrideLog(
  repoFullName: string,
  prNumber: number,
  author: string,
  reason: string,
  commentId?: number,
  originalRiskScore?: number,
  originalAction?: string
): Promise<number> {
  const db = getDatabase();

  const [id] = await db('override_logs').insert({
    repo_full_name: repoFullName,
    pr_number: prNumber,
    author,
    reason,
    comment_id: commentId ?? null,
    original_risk_score: originalRiskScore ?? null,
    original_action: originalAction ?? null,
  });

  log.info({ id, repoFullName, prNumber, author }, 'Log de override salvo');
  return id as number;
}

export async function getOverridesByAuthor(
  author: string,
  limit = 50
): Promise<OverrideLogRecord[]> {
  const db = getDatabase();
  return db('override_logs')
    .where('author', author)
    .orderBy('created_at', 'desc')
    .limit(limit);
}

// ── Modelo de Snapshot de Métricas ──

export async function saveMetricSnapshot(
  period: string,
  doraMetrics: unknown,
  behavioralMetrics: unknown,
  summary: string,
  aiReport?: string,
  repoFullName?: string
): Promise<number> {
  const db = getDatabase();

  const [id] = await db('metric_snapshots').insert({
    period,
    repo_full_name: repoFullName ?? null,
    dora_metrics: JSON.stringify(doraMetrics),
    behavioral_metrics: JSON.stringify(behavioralMetrics),
    summary,
    ai_report: aiReport ?? null,
  });

  log.info({ id, period }, 'Snapshot de métricas salvo');
  return id as number;
}

// ── Aggregation Models (Substituem Memory Engine) ──

export async function getAuthorStats(author: string): Promise<{
  historicalRiskAvg: number | null;
  overrideCount: number;
}> {
  const db = getDatabase();

  const riskResult = await db('pr_analyses')
    .where('pr_author', author)
    .avg('risk_score as avg')
    .first();

  const overrideResult = await db('override_logs')
    .where('author', author)
    .count('* as count')
    .first();

  return {
    historicalRiskAvg: riskResult?.avg ? Math.round(Number(riskResult.avg)) : null,
    overrideCount: overrideResult?.count ? Number(overrideResult.count) : 0,
  };
}

export async function getAggregatedMetricsData(): Promise<{
  totalAnalyses: number;
  avgRisk: number;
  zeroRiskAnalyses: number;
  totalOverrides: number;
  topReviewer: { username: string; count: number } | null;
  recentScores: number[];
  olderScores: number[];
}> {
  const db = getDatabase();

  const [totalRes, riskRes, zeroRiskRes, overridesRes, topReviewerRes] = await Promise.all([
    db('pr_analyses').count('* as count').first(),
    db('pr_analyses').avg('risk_score as avg').first(),
    db('pr_analyses').where('risk_score', 0).count('* as count').first(),
    db('override_logs').count('* as count').first(),
    db('pr_analyses')
      .select('pr_author as username')
      .count('* as count')
      .groupBy('pr_author')
      .orderBy('count', 'desc')
      .first(),
  ]);

  // Busca os últimos scores para tendência (ex: últimos 50)
  const recentScoreRecords = await db('pr_analyses')
    .select('risk_score')
    .orderBy('created_at', 'desc')
    .limit(50);

  const riskScores = recentScoreRecords.map(r => r.risk_score);
  const recentScores = riskScores.slice(0, 25);
  const olderScores = riskScores.slice(25);

  return {
    totalAnalyses: Number(totalRes?.count || 0),
    avgRisk: riskRes?.avg ? Math.round(Number(riskRes.avg)) : 0,
    zeroRiskAnalyses: Number(zeroRiskRes?.count || 0),
    totalOverrides: Number(overridesRes?.count || 0),
    topReviewer: topReviewerRes ? { username: String(topReviewerRes.username), count: Number(topReviewerRes.count) } : null,
    recentScores,
    olderScores,
  };
}

export async function getRepoFailureRates(): Promise<{ repo: string; total: number; failures: number }[]> {
  const db = getDatabase();
  // Failure = risk_score >= 90 (block) ou apenas ter achados. Vamos usar risk_score > 0 como proxy de falha/achado.
  const stats = await db('pr_analyses')
    .select('repo_full_name')
    .count('* as total')
    .sum(db.raw('CASE WHEN risk_score > 0 THEN 1 ELSE 0 END as failures'))
    .groupBy('repo_full_name');

  return stats.map(s => ({
    repo: String(s.repo_full_name),
    total: Number(s.total),
    failures: Number(s.failures),
  }));
}
