// ─────────────────────────────────────────────
// Sentinel — Serviço de Integração com o GitHub
// ─────────────────────────────────────────────

import { Octokit } from '@octokit/rest';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../core/logger.js';
import type { GitHubPullRequest, GitHubCheckRun, GitHubRepo } from '../../types/github.js';
import type { PolicyDecision } from '../../types/policy.js';

const log = createChildLogger({ service: 'github-integration' });

/** Cliente Octokit (inicializado preguiçosamente) */
let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    if (!config.githubToken) {
      throw new Error('GITHUB_TOKEN not configured');
    }
    octokit = new Octokit({ auth: config.githubToken });
  }
  return octokit;
}

/**
 * Busca dados completos do PR via API do GitHub.
 */
export async function fetchPRData(repo: GitHubRepo, prNumber: number): Promise<GitHubPullRequest> {
  log.info({ ...repo, prNumber }, 'Buscando dados do PR');

  const { data } = await getOctokit().pulls.get({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body,
    state: data.state as GitHubPullRequest['state'],
    author: data.user?.login ?? 'unknown',
    baseBranch: data.base.ref,
    headBranch: data.head.ref,
    headSha: data.head.sha,
    url: data.url,
    htmlUrl: data.html_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    mergedAt: data.merged_at,
    additions: data.additions,
    deletions: data.deletions,
    changedFiles: data.changed_files,
    labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')),
    reviewers: data.requested_reviewers?.map((r) => {
      if ('login' in r) return r.login;
      return (r as unknown as { name?: string }).name ?? '';
    }) ?? [],
    isDraft: data.draft ?? false,
  };
}

/**
 * Busca arquivos do PR (arquivos alterados com patches).
 */
export async function fetchPRFiles(
  repo: GitHubRepo,
  prNumber: number
): Promise<Array<{
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}>> {
  log.info({ ...repo, prNumber }, 'Buscando arquivos do PR');

  const { data } = await getOctokit().pulls.listFiles({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
    per_page: 100,
  });

  return data.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  }));
}

/**
 * Busca check runs para um SHA de commit específico.
 */
export async function fetchCheckRuns(
  repo: GitHubRepo,
  ref: string
): Promise<GitHubCheckRun[]> {
  log.info({ ...repo, ref }, 'Buscando check runs');

  const { data } = await getOctokit().checks.listForRef({
    owner: repo.owner,
    repo: repo.repo,
    ref,
  });

  return data.check_runs.map((cr) => ({
    id: cr.id,
    name: cr.name,
    status: cr.status as GitHubCheckRun['status'],
    conclusion: cr.conclusion as GitHubCheckRun['conclusion'],
    startedAt: cr.started_at,
    completedAt: cr.completed_at,
  }));
}

/**
 * Busca o conteúdo de um arquivo do repositório.
 */
export async function fetchFileContent(
  repo: GitHubRepo,
  path: string,
  ref?: string
): Promise<string | null> {
  try {
    const { data } = await getOctokit().repos.getContent({
      owner: repo.owner,
      repo: repo.repo,
      path,
      ref,
    });

    if ('content' in data && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }

    return null;
  } catch (error) {
    log.debug({ error, path }, 'Arquivo não encontrado no repositório');
    return null;
  }
}

/**
 * Posta um comentário em um PR com os resultados da análise do Sentinel.
 */
export async function postComment(
  repo: GitHubRepo,
  prNumber: number,
  decision: PolicyDecision,
  aiExplanation?: string
): Promise<void> {
  log.info(
    { ...repo, prNumber, action: decision.action },
    'Postando comentário no PR'
  );

  const body = formatComment(decision, aiExplanation);

  // Verifica se já existe um comentário do Sentinel para atualizar
  const existingComment = await findSentinelComment(repo, prNumber);

  if (existingComment) {
    await getOctokit().issues.updateComment({
      owner: repo.owner,
      repo: repo.repo,
      comment_id: existingComment.id,
      body,
    });
    log.info({ commentId: existingComment.id }, 'Comentário existente do Sentinel atualizado');
  } else {
    await getOctokit().issues.createComment({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: prNumber,
      body,
    });
    log.info('Novo comentário do Sentinel criado');
  }
}

/**
 * Encontra um comentário existente do Sentinel em um PR (para atualizar em vez de duplicar).
 */
async function findSentinelComment(
  repo: GitHubRepo,
  prNumber: number
): Promise<{ id: number } | null> {
  try {
    const { data: comments } = await getOctokit().issues.listComments({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: prNumber,
      per_page: 50,
    });

    const sentinel = comments.find(
      (c) => c.body?.includes('<!-- sentinel-v3 -->')
    );

    return sentinel ? { id: sentinel.id } : null;
  } catch {
    return null;
  }
}

/**
 * Formata a decisão da política em um comentário de PR em markdown estruturado.
 */
function formatComment(decision: PolicyDecision, aiExplanation?: string): string {
  const emoji = decision.action === 'pass' ? '✅' : decision.action === 'warn' ? '⚠️' : '🚫';
  const badge = getRiskBadge(decision.riskScore.total);

  let comment = `<!-- sentinel-v3 -->\n`;
  comment += `## ${emoji} Sentinel — ${decision.action.toUpperCase()}\n\n`;
  comment += `${badge}\n\n`;
  comment += `**Score de Risco:** ${decision.riskScore.total}/100\n\n`;

  // Detalhamento do score
  comment += `### Detalhamento do Score\n\n`;
  comment += `| Regra | Score | Status |\n`;
  comment += `|-------|-------|--------|\n`;

  for (const result of decision.ruleResults) {
    const status = result.passed ? '✅' : '❌';
    comment += `| ${result.rule} | ${result.score} | ${status} |\n`;
  }

  comment += `\n`;

  // Achados
  if (decision.findings.length > 0) {
    comment += `### Achados (${decision.findings.length})\n\n`;

    for (const finding of decision.findings.slice(0, 10)) {
      const severityEmoji = getSeverityEmoji(finding.severity);
      comment += `- ${severityEmoji} **${finding.title}**`;
      if (finding.file) comment += ` — \`${finding.file}\``;
      comment += `\n  ${finding.description}\n\n`;
    }

    if (decision.findings.length > 10) {
      comment += `\n*...e mais ${decision.findings.length - 10} achados*\n\n`;
    }
  }

  // Explicação por IA (apenas para bloqueios)
  if (aiExplanation) {
    comment += `### 🤖 Análise por IA\n\n`;
    comment += aiExplanation;
    comment += `\n\n`;
  }

  // Rodapé
  comment += `---\n`;
  comment += `*Sentinel — Guardrail Inteligente de PR | ${decision.timestamp}*\n`;
  comment += `*Override: comente \`/sentinel override <motivo>\` (requer papel de mantenedor)*`;

  return comment;
}

function getRiskBadge(score: number): string {
  if (score < 20) return '![Risco: Baixo](https://img.shields.io/badge/Risco-Baixo-brightgreen)';
  if (score < 40) return '![Risco: Moderado](https://img.shields.io/badge/Risco-Moderado-yellow)';
  if (score < 70) return '![Risco: Alto](https://img.shields.io/badge/Risco-Alto-orange)';
  return '![Risco: Crítico](https://img.shields.io/badge/Risco-Crítico-red)';
}

function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🔵';
    default: return 'ℹ️';
  }
}
