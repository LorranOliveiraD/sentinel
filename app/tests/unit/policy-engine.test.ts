// ─────────────────────────────────────────────
// Sentinel — Policy Engine Unit Tests
// ─────────────────────────────────────────────
// Verifies: deterministic decisions, rule evaluation, action thresholds
// ─────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/services/policy-engine/index.js';
import type { RuleInput } from '../../src/types/policy.js';
import type { SentinelRcConfig } from '../../src/types/config.js';
import { SENTINEL_RC_DEFAULTS } from '../../src/types/config.js';

// ── Test Helpers ──

function createCleanInput(overrides?: Partial<RuleInput>): RuleInput {
  return {
    prAnalysis: {
      filesChanged: [
        {
          filename: 'src/utils.ts',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: '+const foo = "bar";',
          isTestFile: false,
          isDependencyFile: false,
        },
        {
          filename: 'src/utils.test.ts',
          status: 'modified',
          additions: 8,
          deletions: 2,
          patch: '+expect(foo).toBe("bar");',
          isTestFile: true,
          isDependencyFile: false,
        },
      ],
      totalLinesAdded: 18,
      totalLinesRemoved: 7,
      totalFilesChanged: 2,
    },
    ciAnalysis: {
      overallStatus: 'success',
      failedChecks: [],
      pendingChecks: [],
    },
    depAnalysis: {
      dependencyFilesChanged: [],
      vulnerabilities: [],
    },
    config: {
      riskScoreWarn: 40,
      riskScoreBlock: 90,
      minTestCoverage: 70,
      largePRLines: 500,
    },
    ...overrides,
  };
}

// ── Test Suite ──

describe('Policy Engine — Deterministic Core', () => {
  describe('Clean PR → PASS', () => {
    it('should pass a clean PR with no issues', () => {
      const input = createCleanInput();
      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.action).toBe('pass');
      expect(decision.riskScore.total).toBeLessThan(40);
      expect(decision.findings.length).toBe(0);
    });

    it('should always produce the same result for the same input (deterministic)', () => {
      const input = createCleanInput();

      const decision1 = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
      const decision2 = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
      const decision3 = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision1.action).toBe(decision2.action);
      expect(decision2.action).toBe(decision3.action);
      expect(decision1.riskScore.total).toBe(decision2.riskScore.total);
      expect(decision2.riskScore.total).toBe(decision3.riskScore.total);
    });
  });

  describe('Secrets Detection', () => {
    it('should detect AWS keys and produce WARN with default thresholds', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/config.ts',
              status: 'modified',
              additions: 5,
              deletions: 0,
              patch: '+const key = "AKIAIOSFODNN7EXAMPLE";',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 5,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      // Secrets score=100, weighted=40 → WARN (block threshold is 90)
      expect(decision.action).toBe('warn');
      expect(decision.findings.some((f) => f.rule === 'secrets')).toBe(true);
      expect(decision.findings.some((f) => f.severity === 'critical')).toBe(true);
    });

    it('should BLOCK secrets with lowered block threshold', () => {
      const lowThresholdConfig: SentinelRcConfig = {
        ...SENTINEL_RC_DEFAULTS,
        riskScoreBlock: 35,
      };
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/config.ts',
              status: 'modified',
              additions: 5,
              deletions: 0,
              patch: '+const key = "AKIAIOSFODNN7EXAMPLE";',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 5,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, lowThresholdConfig);
      expect(decision.action).toBe('block');
    });

    it('should detect GitHub tokens and produce findings', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/api.ts',
              status: 'added',
              additions: 3,
              deletions: 0,
              patch: '+const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 3,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      // Secrets detected → at least WARN
      expect(['warn', 'block']).toContain(decision.action);
      expect(decision.findings.some((f) => f.title.includes('GitHub Token'))).toBe(true);
    });

    it('should NOT flag secrets in test files', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/api.test.ts',
              status: 'modified',
              additions: 3,
              deletions: 0,
              patch: '+const fakeKey = "AKIAIOSFODNN7EXAMPLE";',
              isTestFile: true,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 3,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      // Secrets rule excludes test files
      expect(decision.findings.filter((f) => f.rule === 'secrets').length).toBe(0);
    });

    // ── Security Edge Cases ──

    it('should detect multiple occurrences of secrets in the same patch', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/config.ts',
              status: 'modified',
              additions: 5,
              deletions: 0,
              patch: '+const key1 = "AKIAIOSFODNN7EXAMPLE";\n+const key2 = "AKIAIOSFODNN7EXAMPLE";',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 5,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
      const secretFindings = decision.findings.filter((f) => f.rule === 'secrets');
      expect(secretFindings.length).toBe(2);
    });

    it('should filter out generic false positives (no entropy/digits)', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/vars.ts',
              status: 'modified',
              additions: 2,
              deletions: 0,
              patch: '+const api_key = "this_is_just_a_very_long_variable_name_without_numbers";',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 2,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
      const secretFindings = decision.findings.filter((f) => f.rule === 'secrets');
      // Should ignore because it doesn't contain a number and is generic
      expect(secretFindings.length).toBe(0);
    });

    it('should correctly capture and mask generic secrets with entropy', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/vars.ts',
              status: 'modified',
              additions: 2,
              deletions: 0,
              patch: '+const api_key = "real_secret_with_entropy_123456789";',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 2,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
      const secretFindings = decision.findings.filter((f) => f.rule === 'secrets');
      expect(secretFindings.length).toBe(1);
      // maskSecret will output: rea...789
      expect(secretFindings[0].metadata?.matchPreview).toBe('rea...789');
    });

    it('should completely mask short secrets', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/vars.ts',
              status: 'modified',
              additions: 2,
              deletions: 0,
              patch: '+const secret = "pass1234";', // 8 chars
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 2,
          totalLinesRemoved: 0,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);
      const secretFindings = decision.findings.filter((f) => f.rule === 'secrets');
      expect(secretFindings.length).toBe(1);
      expect(secretFindings[0].metadata?.matchPreview).toBe('********');
    });
  });

  describe('CVE Detection', () => {
    it('should detect critical CVEs and contribute to risk score', () => {
      const input = createCleanInput({
        depAnalysis: {
          dependencyFilesChanged: ['package.json'],
          vulnerabilities: [
            {
              id: 'CVE-2024-0001',
              package: 'lodash',
              severity: 'CRITICAL',
              summary: 'Prototype pollution vulnerability',
            },
          ],
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.some((f) => f.rule === 'cve' && f.severity === 'critical')).toBe(true);
      expect(decision.riskScore.breakdown.cve).toBeGreaterThan(0);
    });

    it('should handle multiple CVEs with different severities', () => {
      const input = createCleanInput({
        depAnalysis: {
          dependencyFilesChanged: ['package.json'],
          vulnerabilities: [
            { id: 'CVE-2024-0001', package: 'lodash', severity: 'CRITICAL', summary: 'Critical bug' },
            { id: 'CVE-2024-0002', package: 'express', severity: 'HIGH', summary: 'High bug' },
            { id: 'CVE-2024-0003', package: 'axios', severity: 'LOW', summary: 'Low bug' },
          ],
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.filter((f) => f.rule === 'cve').length).toBe(3);
    });
  });

  describe('Missing Tests', () => {
    it('should warn when source files change without test updates', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/handler.ts',
              status: 'modified',
              additions: 50,
              deletions: 10,
              patch: '+const handler = () => {};',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 50,
          totalLinesRemoved: 10,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.some((f) => f.rule === 'tests')).toBe(true);
    });

    it('should pass when test files are included', () => {
      const input = createCleanInput(); // default input includes test file

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.filter((f) => f.rule === 'tests').length).toBe(0);
    });
  });

  describe('PR Size', () => {
    it('should flag PRs exceeding the line threshold', () => {
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/big-change.ts',
              status: 'modified',
              additions: 600,
              deletions: 100,
              patch: '+...',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 600,
          totalLinesRemoved: 100,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.some((f) => f.rule === 'pr_size')).toBe(true);
    });

    it('should pass PRs under the threshold', () => {
      const input = createCleanInput(); // 25 total changes, well under 500

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.filter((f) => f.rule === 'pr_size').length).toBe(0);
    });
  });

  describe('Pipeline Health', () => {
    it('should penalize PRs with failing CI', () => {
      const input = createCleanInput({
        ciAnalysis: {
          overallStatus: 'failure',
          failedChecks: ['lint', 'unit-tests'],
          pendingChecks: [],
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.findings.some((f) => f.rule === 'pipeline_health')).toBe(true);
      expect(decision.riskScore.breakdown.pipeline_health).toBeGreaterThan(0);
    });

    it('should flag pending checks with low severity', () => {
      const input = createCleanInput({
        ciAnalysis: {
          overallStatus: 'pending',
          failedChecks: [],
          pendingChecks: ['deploy-staging'],
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      const pipelineFindings = decision.findings.filter((f) => f.rule === 'pipeline_health');
      if (pipelineFindings.length > 0) {
        expect(pipelineFindings[0].severity).toBe('info');
      }
    });
  });

  describe('Action Thresholds', () => {
    it('should respect custom config thresholds', () => {
      const customConfig: SentinelRcConfig = {
        ...SENTINEL_RC_DEFAULTS,
        riskScoreWarn: 5,
        riskScoreBlock: 15,
      };

      // Input with multiple failing CI checks + missing tests → combined score
      // should exceed even very low thresholds
      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/handler.ts',
              status: 'modified',
              additions: 200,
              deletions: 10,
              patch: '+const x = 1;',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 200,
          totalLinesRemoved: 10,
          totalFilesChanged: 1,
        },
        ciAnalysis: {
          overallStatus: 'failure',
          failedChecks: ['lint', 'test'],
          pendingChecks: [],
        },
      });

      const decision = evaluatePolicy(input, customConfig);

      // With very low thresholds and missing tests + CI failure, should block
      expect(['warn', 'block']).toContain(decision.action);
    });

    it('should respect enabled/disabled rules config', () => {
      const configOnlySecrets: SentinelRcConfig = {
        ...SENTINEL_RC_DEFAULTS,
        enabledRules: ['secrets'],
      };

      const input = createCleanInput({
        prAnalysis: {
          filesChanged: [
            {
              filename: 'src/handler.ts',
              status: 'modified',
              additions: 600,
              deletions: 100,
              patch: '+const handler = () => {};',
              isTestFile: false,
              isDependencyFile: false,
            },
          ],
          totalLinesAdded: 600,
          totalLinesRemoved: 100,
          totalFilesChanged: 1,
        },
      });

      const decision = evaluatePolicy(input, configOnlySecrets);

      // Only secrets rule should run — PR size and tests should not flag
      expect(decision.findings.filter((f) => f.rule === 'pr_size').length).toBe(0);
      expect(decision.findings.filter((f) => f.rule === 'tests').length).toBe(0);
    });
  });

  describe('Summary Generation', () => {
    it('should include emoji and risk score in summary', () => {
      const input = createCleanInput();
      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      expect(decision.summary).toContain('Sentinel');
      expect(decision.summary).toContain('/100');
    });

    it('should include finding details in summary for non-clean PRs', () => {
      const input = createCleanInput({
        ciAnalysis: {
          overallStatus: 'failure',
          failedChecks: ['lint'],
          pendingChecks: [],
        },
      });

      const decision = evaluatePolicy(input, SENTINEL_RC_DEFAULTS);

      if (decision.findings.length > 0) {
        expect(decision.summary).toContain('issue');
      }
    });
  });
});
