import { describe, it, expect, vi } from 'vitest';
import { evaluatePolicy } from '../../src/services/policy-engine/index.js';
import { buildContext } from '../../src/services/context-builder/index.js';
import type { RuleInput } from '../../src/types/policy.js';
import { SENTINEL_RC_DEFAULTS } from '../../src/types/config.js';

// Silence logger
vi.mock('../../src/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/**
 * Integration test: simulates the full deterministic pipeline
 * (analyzers output → policy engine → context builder)
 * without network calls.
 */
describe('PR Analysis Flow — Deterministic Pipeline', () => {
  it('clean PR → PASS → minimal context', () => {
    const input: RuleInput = {
      prAnalysis: {
        filesChanged: [
          { filename: 'src/utils.ts', status: 'modified', additions: 10, deletions: 5, patch: '+const x = 1;', isTestFile: false, isDependencyFile: false },
          { filename: 'src/utils.test.ts', status: 'modified', additions: 8, deletions: 2, patch: '+expect(x).toBe(1);', isTestFile: true, isDependencyFile: false },
        ],
        totalLinesAdded: 18, totalLinesRemoved: 7, totalFilesChanged: 2,
      },
      ciAnalysis: { overallStatus: 'success', failedChecks: [], pendingChecks: [] },
      depAnalysis: { dependencyFilesChanged: [], vulnerabilities: [] },
      config: { riskScoreWarn: 40, riskScoreBlock: 90, minTestCoverage: 70, largePRLines: 500 },
    };

    const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
    expect(decision.action).toBe('pass');

    const ctx = buildContext({
      correlationId: 'int-1', repository: { owner: 'o', repo: 'r' },
      prNumber: 1, prTitle: 'clean PR', prAuthor: 'dev',
      prAnalysis: input.prAnalysis as any,
      ciAnalysis: { overallStatus: 'success', checkRuns: [], failedChecks: [], pendingChecks: [] },
      depAnalysis: { dependencyFilesChanged: [], vulnerabilities: [] },
      findings: decision.findings,
    });

    expect(ctx.tokenEstimate).toBeLessThanOrEqual(1000);
    expect(ctx.context.findings.secrets).toBe(0);
  });

  it('secret + CVE PR → high risk score with multiple findings', () => {
    const input: RuleInput = {
      prAnalysis: {
        filesChanged: [
          { filename: 'src/config.ts', status: 'modified', additions: 5, deletions: 0, patch: '+const k = "AKIAIOSFODNN7EXAMPLE";', isTestFile: false, isDependencyFile: false },
        ],
        totalLinesAdded: 5, totalLinesRemoved: 0, totalFilesChanged: 1,
      },
      ciAnalysis: { overallStatus: 'failure', failedChecks: ['lint'], pendingChecks: [] },
      depAnalysis: {
        dependencyFilesChanged: ['package.json'],
        vulnerabilities: [{ id: 'CVE-2024-0001', package: 'lodash', severity: 'CRITICAL', summary: 'proto pollution' }],
      },
      config: { riskScoreWarn: 40, riskScoreBlock: 90, minTestCoverage: 70, largePRLines: 500 },
    };

    const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
    // secrets(40) + cve(30) + pipeline(4) + tests(1) = ~75 → WARN
    expect(['warn', 'block']).toContain(decision.action);
    expect(decision.findings.length).toBeGreaterThan(0);
    expect(decision.riskScore.total).toBeGreaterThanOrEqual(40);

    const ctx = buildContext({
      correlationId: 'int-2', repository: { owner: 'o', repo: 'r' },
      prNumber: 2, prTitle: 'dangerous PR', prAuthor: 'dev',
      prAnalysis: input.prAnalysis as any,
      ciAnalysis: { overallStatus: 'failure', checkRuns: [], failedChecks: ['lint'], pendingChecks: [] },
      depAnalysis: { dependencyFilesChanged: ['package.json'], vulnerabilities: [{ id: 'CVE-2024-0001', package: 'lodash', severity: 'CRITICAL' as any, summary: 'proto', affectedVersions: '*', fixedVersions: null }] },
      findings: decision.findings,
    });

    expect(ctx.context.findings.secrets).toBeGreaterThan(0);
    expect(ctx.context.findings.cves.critical).toBe(1);
    expect(ctx.context.findings.pipelineHealthy).toBe(false);
  });

  it('BLOCK when using lowered threshold with secrets + CVE', () => {
    const lowConfig = { ...SENTINEL_RC_DEFAULTS, riskScoreBlock: 50 };
    const input: RuleInput = {
      prAnalysis: {
        filesChanged: [
          { filename: 'src/config.ts', status: 'modified', additions: 5, deletions: 0, patch: '+const k = "AKIAIOSFODNN7EXAMPLE";', isTestFile: false, isDependencyFile: false },
        ],
        totalLinesAdded: 5, totalLinesRemoved: 0, totalFilesChanged: 1,
      },
      ciAnalysis: { overallStatus: 'failure', failedChecks: ['lint'], pendingChecks: [] },
      depAnalysis: {
        dependencyFilesChanged: ['package.json'],
        vulnerabilities: [{ id: 'CVE-2024-0001', package: 'lodash', severity: 'CRITICAL', summary: 'proto pollution' }],
      },
      config: { riskScoreWarn: 20, riskScoreBlock: 50, minTestCoverage: 70, largePRLines: 500 },
    };

    const decision = evaluatePolicy(input, lowConfig);
    expect(decision.action).toBe('block');
  });

  it('large PR without tests produces findings', () => {
    const input: RuleInput = {
      prAnalysis: {
        filesChanged: Array.from({ length: 8 }, (_, i) => ({
          filename: `src/module-${i}.ts`, status: 'modified', additions: 80, deletions: 20,
          patch: '+code', isTestFile: false, isDependencyFile: false,
        })),
        totalLinesAdded: 640, totalLinesRemoved: 160, totalFilesChanged: 8,
      },
      ciAnalysis: { overallStatus: 'success', failedChecks: [], pendingChecks: [] },
      depAnalysis: { dependencyFilesChanged: [], vulnerabilities: [] },
      config: { riskScoreWarn: 40, riskScoreBlock: 90, minTestCoverage: 70, largePRLines: 500 },
    };

    const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
    expect(decision.findings.some(f => f.rule === 'pr_size')).toBe(true);
    expect(decision.findings.some(f => f.rule === 'tests')).toBe(true);
    expect(decision.riskScore.total).toBeGreaterThan(0);
  });

  it('same input always produces same decision (determinism)', () => {
    const input: RuleInput = {
      prAnalysis: {
        filesChanged: [
          { filename: 'src/x.ts', status: 'modified', additions: 100, deletions: 50, patch: '+const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";', isTestFile: false, isDependencyFile: false },
        ],
        totalLinesAdded: 100, totalLinesRemoved: 50, totalFilesChanged: 1,
      },
      ciAnalysis: { overallStatus: 'success', failedChecks: [], pendingChecks: [] },
      depAnalysis: { dependencyFilesChanged: [], vulnerabilities: [] },
      config: { riskScoreWarn: 40, riskScoreBlock: 90, minTestCoverage: 70, largePRLines: 500 },
    };

    const results = Array.from({ length: 5 }, () => evaluatePolicy(input, SENTINEL_RC_DEFAULTS));
    const actions = results.map(r => r.action);
    const scores = results.map(r => r.riskScore.total);

    expect(new Set(actions).size).toBe(1);
    expect(new Set(scores).size).toBe(1);
  });
});
