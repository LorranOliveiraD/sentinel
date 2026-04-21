// ─────────────────────────────────────────────
// Sentinel V3 — Serviço Analisador de PR
// ─────────────────────────────────────────────

import path from 'node:path';
import { createChildLogger } from '../../core/logger.js';
import type { PRAnalysisResult, ChangedFile } from '../../types/github.js';
import { isTestFile, isConfigFile, isDependencyFile } from '../../utils/file-patterns.js';

const log = createChildLogger({ service: 'pr-analyzer' });

/**
 * Analisa alterações de arquivos do PR a partir da resposta da API do GitHub.
 *
 * @param files - Array de objetos de arquivo do endpoint de arquivos de PR do GitHub
 * @returns Resultado estruturado da análise
 */
export function analyzePRFiles(
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>
): PRAnalysisResult {
  log.info({ fileCount: files.length }, 'Analisando arquivos do PR');

  const changedFiles: ChangedFile[] = files.map((file) => ({
    filename: file.filename,
    status: normalizeStatus(file.status),
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch ?? null,
    extension: path.extname(file.filename).toLowerCase(),
    isTestFile: isTestFile(file.filename),
    isConfigFile: isConfigFile(file.filename),
    isDependencyFile: isDependencyFile(file.filename),
  }));

  const totalLinesAdded = changedFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalLinesRemoved = changedFiles.reduce((sum, f) => sum + f.deletions, 0);

  // Constrói distribuição por tipo de arquivo (por extensão)
  const fileTypeBreakdown: Record<string, number> = {};
  for (const file of changedFiles) {
    const ext = file.extension || '(sem extensão)';
    fileTypeBreakdown[ext] = (fileTypeBreakdown[ext] ?? 0) + 1;
  }

  const result: PRAnalysisResult = {
    filesChanged: changedFiles,
    totalLinesAdded,
    totalLinesRemoved,
    totalFilesChanged: changedFiles.length,
    fileTypeBreakdown,
  };

  log.info(
    {
      totalFiles: result.totalFilesChanged,
      linesAdded: result.totalLinesAdded,
      linesRemoved: result.totalLinesRemoved,
      testFiles: changedFiles.filter((f) => f.isTestFile).length,
      depFiles: changedFiles.filter((f) => f.isDependencyFile).length,
    },
    'Análise do PR concluída'
  );

  return result;
}

/**
 * Faz parse de uma string de diff unificado em patches individuais por arquivo.
 * Útil quando recebemos um diff completo ao invés de dados por arquivo.
 */
export function parseDiffContent(diffContent: string): Array<{
  filename: string;
  additions: number;
  deletions: number;
  patch: string;
}> {
  const files: Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch: string;
  }> = [];

  // Divide pelos headers de diff
  const fileDiffs = diffContent.split(/^diff --git /m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split('\n');

    // Extrai nome do arquivo do header "a/caminho b/caminho"
    const headerMatch = lines[0]?.match(/a\/(.+?)\s+b\/(.+)/);
    const filename = headerMatch?.[2] ?? headerMatch?.[1] ?? 'desconhecido';

    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    files.push({
      filename,
      additions,
      deletions,
      patch: fileDiff,
    });
  }

  log.debug({ parsedFiles: files.length }, 'Conteúdo do diff parseado');
  return files;
}


function normalizeStatus(status: string): ChangedFile['status'] {
  switch (status) {
    case 'added': return 'added';
    case 'removed': return 'removed';
    case 'renamed': return 'renamed';
    default: return 'modified';
  }
}
