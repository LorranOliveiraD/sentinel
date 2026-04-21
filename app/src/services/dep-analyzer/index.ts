// ─────────────────────────────────────────────
// Sentinel V3 — Serviço Analisador de Dependências
// ─────────────────────────────────────────────

import { createChildLogger } from '../../core/logger.js';
import { isDependencyFile } from '../../utils/file-patterns.js';

const log = createChildLogger({ service: 'dep-analyzer' });

/** Timeout padrão para chamadas HTTP à API OSV (10 segundos) */
const OSV_TIMEOUT_MS = 10_000;

/** Número máximo de queries concorrentes à API OSV */
const OSV_CONCURRENCY = 5;

/** Vulnerabilidade encontrada via API OSV */
export interface Vulnerability {
  id: string;
  package: string;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  summary: string;
  affectedVersions: string;
  fixedVersions: string | null;
}

/** Resultado da análise de dependências */
export interface DepAnalysisResult {
  dependencyFilesChanged: string[];
  vulnerabilities: Vulnerability[];
  totalDepsScanned: number;
}

/** Estrutura de resposta da API OSV */
interface OSVQueryResponse {
  vulns?: Array<{
    id: string;
    summary?: string;
    affected?: Array<{
      package?: {
        name?: string;
        ecosystem?: string;
      };
      ranges?: Array<{
        events?: Array<{
          introduced?: string;
          fixed?: string;
        }>;
      }>;
    }>;
    database_specific?: {
      severity?: string;
    };
  }>;
}

/**
 * Analisa alterações de dependências em um PR.
 *
 * @param changedFiles - Lista de caminhos de arquivos alterados
 * @param getFileContent - Função assíncrona para buscar conteúdo de arquivo do repositório
 * @returns Resultado da análise de dependências com achados de CVE
 */
export async function analyzeDependencies(
  changedFiles: string[],
  getFileContent?: (path: string) => Promise<string | null>
): Promise<DepAnalysisResult> {
  const dependencyFiles = changedFiles.filter(isDependencyFile);

  log.info(
    { totalFiles: changedFiles.length, dependencyFiles: dependencyFiles.length },
    'Analisando dependências'
  );

  if (dependencyFiles.length === 0) {
    log.info('Nenhum arquivo de dependência alterado');
    return {
      dependencyFilesChanged: [],
      vulnerabilities: [],
      totalDepsScanned: 0,
    };
  }

  const vulnerabilities: Vulnerability[] = [];
  let totalDepsScanned = 0;

  // Se podemos acessar o conteúdo do arquivo, extraímos pacotes e escaneamos por CVEs
  if (getFileContent) {
    for (const depFile of dependencyFiles) {
      try {
        const content = await getFileContent(depFile);
        if (!content) continue;

        const packages = extractPackages(depFile, content);
        totalDepsScanned += packages.length;

        // Consulta pacotes em lotes concorrentes para performance
        const vulns = await queryOSVBatch(packages);
        vulnerabilities.push(...vulns);
      } catch (error) {
        log.error({ error, file: depFile }, 'Erro ao analisar arquivo de dependência');
      }
    }
  }

  const result: DepAnalysisResult = {
    dependencyFilesChanged: dependencyFiles,
    vulnerabilities,
    totalDepsScanned,
  };

  log.info(
    {
      dependencyFiles: result.dependencyFilesChanged.length,
      vulnerabilities: result.vulnerabilities.length,
      depsScanned: result.totalDepsScanned,
    },
    'Análise de dependências concluída'
  );

  return result;
}

/**
 * Consulta múltiplos pacotes na API OSV com concorrência limitada.
 * Processa em lotes de OSV_CONCURRENCY para evitar sobrecarregar a API.
 */
async function queryOSVBatch(
  packages: Array<{ name: string; version: string; ecosystem: string }>
): Promise<Vulnerability[]> {
  const vulnerabilities: Vulnerability[] = [];
  const batches = chunk(packages, OSV_CONCURRENCY);

  for (const batch of batches) {
    const results = await Promise.allSettled(
      batch.map((pkg) => queryOSV(pkg.name, pkg.version, pkg.ecosystem))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        vulnerabilities.push(...result.value);
      }
    }
  }

  return vulnerabilities;
}

/**
 * Consulta a API OSV.dev para vulnerabilidades conhecidas.
 * https://api.osv.dev/v1/query
 *
 * Inclui timeout de 10 segundos para evitar travamento do fluxo.
 */
async function queryOSV(
  packageName: string,
  version: string,
  ecosystem: string
): Promise<Vulnerability[]> {
  try {
    const response = await fetch('https://api.osv.dev/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package: { name: packageName, ecosystem },
        version,
      }),
      signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn(
        { status: response.status, package: packageName },
        'API OSV retornou status não-OK'
      );
      return [];
    }

    const data = (await response.json()) as OSVQueryResponse;

    if (!data.vulns || data.vulns.length === 0) return [];

    return data.vulns.map((vuln) => {
      const affected = vuln.affected?.[0];
      const ranges = affected?.ranges?.[0]?.events ?? [];

      return {
        id: vuln.id,
        package: packageName,
        severity: mapSeverity(vuln.database_specific?.severity),
        summary: vuln.summary ?? 'Sem descrição disponível',
        affectedVersions: ranges.find((e) => e.introduced)?.introduced ?? 'desconhecido',
        fixedVersions: ranges.find((e) => e.fixed)?.fixed ?? null,
      };
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      log.warn({ package: packageName }, 'Timeout ao consultar API OSV');
    } else {
      log.error({ error, package: packageName }, 'Falha ao consultar API OSV');
    }
    return [];
  }
}

/**
 * Extrai nomes e versões de pacotes de arquivos de dependência.
 */
function extractPackages(
  filename: string,
  content: string
): Array<{ name: string; version: string; ecosystem: string }> {
  const packages: Array<{ name: string; version: string; ecosystem: string }> = [];

  try {
    if (filename.endsWith('package.json')) {
      const parsed = JSON.parse(content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const allDeps = {
        ...parsed.dependencies,
        ...parsed.devDependencies,
      };

      for (const [name, version] of Object.entries(allDeps)) {
        packages.push({
          name,
          version: cleanVersion(version),
          ecosystem: 'npm',
        });
      }
    } else if (filename.endsWith('requirements.txt')) {
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)==(.+)/);
        if (match) {
          packages.push({
            name: match[1],
            version: match[2],
            ecosystem: 'PyPI',
          });
        }
      }
    } else if (filename.endsWith('go.mod')) {
      const lines = content.split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\S+)\s+(v\S+)/);
        if (match) {
          packages.push({
            name: match[1],
            version: match[2],
            ecosystem: 'Go',
          });
        }
      }
    }
  } catch (error) {
    log.warn({ error, filename }, 'Falha ao fazer parse do arquivo de dependência');
  }

  return packages;
}

// ── Auxiliares ──

function mapSeverity(severity?: string): Vulnerability['severity'] {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL': return 'CRITICAL';
    case 'HIGH': return 'HIGH';
    case 'MODERATE':
    case 'MEDIUM': return 'MODERATE';
    default: return 'LOW';
  }
}

function cleanVersion(version: string): string {
  return version.replace(/^[\^~>=<]+/, '').trim();
}

/**
 * Divide um array em lotes de tamanho fixo.
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
