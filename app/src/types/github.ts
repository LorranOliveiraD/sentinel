// ─────────────────────────────────────────────
// Sentinel — Definições de Tipos do GitHub
// ─────────────────────────────────────────────

/** Resultado da análise do diff do PR */
export interface PRAnalysisResult {
  filesChanged: ChangedFile[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalFilesChanged: number;
  fileTypeBreakdown: Record<string, number>;
}

/** Arquivo individual alterado em um diff de PR */
export interface ChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  patch: string | null;
  extension: string;
  isTestFile: boolean;
  isConfigFile: boolean;
  isDependencyFile: boolean;
}

/** Dados do Pull Request do GitHub (normalizados da API) */
export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  url: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  reviewers: string[];
  isDraft: boolean;
}

/** Check Run do GitHub (normalizado) */
export interface GitHubCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** Referência de repositório do GitHub */
export interface GitHubRepo {
  owner: string;
  repo: string;
}

/** Payload de comentário do GitHub para detecção de override */
export interface GitHubComment {
  id: number;
  body: string;
  author: string;
  authorAssociation: string;
  createdAt: string;
  issueNumber: number;
}

/** Comentário estruturado de PR postado pelo Sentinel */
export interface SentinelComment {
  header: string;
  riskBadge: string;
  findingsSummary: string;
  details: string;
  explanation?: string;
  footer: string;
}
