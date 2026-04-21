// ─────────────────────────────────────────────
// Sentinel — Padrões de Arquivos Compartilhados
// ─────────────────────────────────────────────

/**
 * Módulo centralizado de padrões de detecção de tipos de arquivo.
 * Evita duplicação entre pr-analyzer, dep-analyzer, secrets e tests.
 */

/** Extensões de arquivo comumente associadas a arquivos de teste */
export const TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\/__tests__\//,
  /\/test\//,
  /\.tests\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /test_.*\.py$/,
];

/** Extensões de arquivos de configuração */
export const CONFIG_FILE_PATTERNS: RegExp[] = [
  /\.ya?ml$/,
  /\.json$/,
  /\.toml$/,
  /\.ini$/,
  /\.env/,
  /\.config\.[jt]s$/,
  /Dockerfile/,
  /docker-compose/,
  /\.sentinelrc/,
];

/** Arquivos de manifesto de dependências (lista canônica) */
export const DEPENDENCY_FILE_PATTERNS: RegExp[] = [
  /package\.json$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /requirements\.txt$/,
  /Pipfile$/,
  /Pipfile\.lock$/,
  /go\.mod$/,
  /go\.sum$/,
  /Gemfile$/,
  /Gemfile\.lock$/,
  /Cargo\.toml$/,
  /Cargo\.lock$/,
  /composer\.json$/,
  /composer\.lock$/,
  /pom\.xml$/,
  /build\.gradle$/,
];

/** Arquivos que comumente contêm padrões intencionais semelhantes a segredos */
export const SECRET_EXCLUDED_FILES: RegExp[] = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.example$/,
  /\.sample$/,
  /\.md$/,
  /\.lock$/,
  /CHANGELOG/,
  /LICENSE/,
];

/** Arquivos que não requerem mudanças de testes correspondentes */
export const NON_CODE_FILE_PATTERNS: RegExp[] = [
  /\.md$/,
  /\.txt$/,
  /\.ya?ml$/,
  /\.json$/,
  /\.toml$/,
  /\.ini$/,
  /\.env/,
  /\.lock$/,
  /Dockerfile/,
  /docker-compose/,
  /\.gitignore/,
  /\.dockerignore/,
  /LICENSE/,
  /CHANGELOG/,
  /\.css$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.ico$/,
];

// ── Funções auxiliares ──

export function isTestFile(filename: string): boolean {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

export function isConfigFile(filename: string): boolean {
  return CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

export function isDependencyFile(filename: string): boolean {
  return DEPENDENCY_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

export function isNonCodeFile(filename: string): boolean {
  return NON_CODE_FILE_PATTERNS.some((pattern) => pattern.test(filename));
}

export function isSecretExcludedFile(filename: string): boolean {
  return SECRET_EXCLUDED_FILES.some((pattern) => pattern.test(filename));
}
