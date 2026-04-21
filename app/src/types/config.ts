// ─────────────────────────────────────────────
// Sentinel — Definições de Tipos de Configuração
// ─────────────────────────────────────────────

/** Configuração a nível de aplicação (a partir de variáveis de ambiente) */
export interface AppConfig {
  /** Ambiente atual */
  nodeEnv: 'development' | 'production' | 'test';

  /** Porta do servidor */
  port: number;

  /** Nível de log */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /** Segredo HMAC do webhook do GitHub */
  githubWebhookSecret: string;

  /** Token da API do GitHub (PAT ou token de App) */
  githubToken: string;

  /** Chave da API Anthropic para o Claude */
  anthropicApiKey: string;

  /** Token do Bot do Slack */
  slackBotToken: string;

  /** Segredo de assinatura do Slack */
  slackSigningSecret: string;

  /** Canal do Slack para alertas */
  slackChannelAlerts: string;

  /** Canal do Slack para relatórios */
  slackChannelReports: string;

  /** URL de conexão PostgreSQL (produção) */
  databaseUrl: string;

  /** Caminho do arquivo SQLite (desenvolvimento) */
  sqlitePath: string;

  /** Expressão cron para relatórios semanais */
  weeklyReportCron: string;

  /** Chave da API do Google */
  googleApiKey: string;
}

/** Configuração a nível de repositório (a partir do .sentinelrc.yml) */
export interface SentinelRcConfig {
  /** Limiar do score de risco para avisos (0-100) */
  riskScoreWarn: number;

  /** Limiar do score de risco para bloqueio (0-100) */
  riskScoreBlock: number;

  /** Porcentagem mínima de cobertura de testes obrigatória */
  minTestCoverage: number;

  /** Limiar de tamanho de PR em total de linhas alteradas */
  largePRLines: number;

  /** Regras a habilitar (null = todas habilitadas) */
  enabledRules?: string[];

  /** Regras a desabilitar */
  disabledRules?: string[];

  /** Padrões de arquivos a excluir da análise */
  excludePatterns?: string[];

  /** Padrões personalizados de segredos (strings regex) */
  customSecretPatterns?: string[];
}

/** Valores padrão para o .sentinelrc.yml */
export const SENTINEL_RC_DEFAULTS: SentinelRcConfig = {
  riskScoreWarn: 40,
  riskScoreBlock: 90,
  minTestCoverage: 80,
  largePRLines: 500,
  enabledRules: undefined,
  disabledRules: [],
  excludePatterns: [
    '*.lock',
    '*.min.js',
    '*.min.css',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ],
  customSecretPatterns: [],
};
