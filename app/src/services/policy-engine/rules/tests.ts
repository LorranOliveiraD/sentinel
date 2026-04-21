// ─────────────────────────────────────────────
// Sentinel V3 — Regra de Cobertura de Testes
// ─────────────────────────────────────────────
// DETERMINÍSTICO — IA não permitida neste módulo
// ─────────────────────────────────────────────

import type { RuleEvaluator, RuleInput, RuleResult, Finding } from '../../../types/policy.js';
import { isNonCodeFile } from '../../../utils/file-patterns.js';

/**
 * Avaliador de Regra de Testes
 *
 * Verifica se arquivos de teste foram modificados quando arquivos fonte mudaram.
 * Penaliza PRs que modificam código sem incluir atualizações de testes.
 *
 * Lógica:
 * - Se apenas config/docs mudaram → aprovado (testes não esperados)
 * - Se arquivos fonte e de teste mudaram → aprovado
 * - Se arquivos fonte mudaram mas nenhum de teste → avisar/penalizar
 */
export class TestsRule implements RuleEvaluator {
  readonly category = 'tests' as const;

  evaluate(input: RuleInput): RuleResult {
    const findings: Finding[] = [];
    const files = input.prAnalysis.filesChanged;

    // Separa arquivos fonte e de teste
    const sourceFiles = files.filter(
      (f) => !f.isTestFile && !isNonCodeFile(f.filename) && f.additions > 0
    );
    const testFiles = files.filter((f) => f.isTestFile);

    // Se nenhum arquivo fonte mudou, regra de testes não se aplica
    if (sourceFiles.length === 0) {
      return {
        rule: 'tests',
        findings: [],
        score: 0,
        passed: true,
      };
    }

    const hasTestChanges = testFiles.length > 0;
    const sourceToTestRatio = testFiles.length / sourceFiles.length;

    if (!hasTestChanges) {
      // Nenhum arquivo de teste tocado — penalizar
      const score = calculateMissingTestScore(sourceFiles.length, input.prAnalysis.totalLinesAdded);

      findings.push({
        id: 'tests-missing-1',
        rule: 'tests',
        severity: score >= 30 ? 'medium' : 'low',
        title: 'No test files modified',
        description: `${sourceFiles.length} source file(s) were modified but no test files were updated. Consider adding or updating tests for the changed code.`,
        score,
        metadata: {
          sourceFilesChanged: sourceFiles.length,
          testFilesChanged: 0,
          testsIncluded: false,
          sourceFiles: sourceFiles.slice(0, 5).map((f) => f.filename),
        },
      });
    } else if (sourceToTestRatio < 0.3 && sourceFiles.length > 3) {
      // Proporção teste-fonte muito baixa para PRs maiores
      findings.push({
        id: 'tests-low-ratio-1',
        rule: 'tests',
        severity: 'low',
        title: 'Low test coverage for changes',
        description: `${sourceFiles.length} source files changed but only ${testFiles.length} test file(s) updated. Test-to-source ratio: ${Math.round(sourceToTestRatio * 100)}%.`,
        score: 10,
        metadata: {
          sourceFilesChanged: sourceFiles.length,
          testFilesChanged: testFiles.length,
          testsIncluded: true,
          ratio: sourceToTestRatio,
        },
      });
    }

    const totalScore = findings.reduce((sum, f) => sum + f.score, 0);

    return {
      rule: 'tests',
      findings,
      score: Math.min(totalScore, 50), // Cap at 50
      passed: findings.length === 0,
    };
  }
}

/**
 * Calculate score for missing tests based on PR size.
 * Larger PRs without tests get higher penalties.
 */
function calculateMissingTestScore(sourceFileCount: number, linesAdded: number): number {
  let score = 10; // Base penalty

  // Scale by file count
  if (sourceFileCount > 5) score += 10;
  if (sourceFileCount > 10) score += 10;

  // Scale by lines added
  if (linesAdded > 100) score += 5;
  if (linesAdded > 300) score += 5;

  return Math.min(score, 40);
}

