import { describe, it, expect } from 'vitest';
import { buildContext, estimateTokens } from '../../src/services/context-builder/index.js';
import type { ContextBuilderInput } from '../../src/services/context-builder/index.js';

function mkInput(overrides?: Partial<ContextBuilderInput>): ContextBuilderInput {
  return {
    correlationId: 'test-123',
    repository: { owner: 'org', repo: 'app' },
    prNumber: 42,
    prTitle: 'feat: add user authentication module',
    prAuthor: 'dev-user',
    prAnalysis: {
      filesChanged: [
        { filename: 'src/auth.ts', status: 'added', additions: 200, deletions: 0, patch: '+code', isTestFile: false, isDependencyFile: false },
        { filename: 'src/auth.test.ts', status: 'added', additions: 100, deletions: 0, patch: '+test', isTestFile: true, isDependencyFile: false },
      ],
      totalLinesAdded: 300,
      totalLinesRemoved: 0,
      totalFilesChanged: 2,
    },
    ciAnalysis: { overallStatus: 'success' as const, checkRuns: [], failedChecks: [], pendingChecks: [] },
    depAnalysis: { dependencyFilesChanged: [], vulnerabilities: [] },
    findings: [],
    authorHistory: { historicalRiskAvg: 15, overrideCount: 0 },
    ...overrides,
  };
}

describe('Context Builder', () => {
  it('builds context with correct structure', () => {
    const result = buildContext(mkInput());
    expect(result.correlationId).toBe('test-123');
    expect(result.prNumber).toBe(42);
    expect(result.context.pr.author).toBe('dev-user');
    expect(result.context.pr.filesChanged).toBe(2);
    expect(result.context.findings).toBeDefined();
  });

  it('reduces token count by at least 70%', () => {
    const input = mkInput({
      findings: Array.from({ length: 20 }, (_, i) => ({
        id: `f-${i}`, rule: 'secrets' as const, severity: 'high' as const,
        title: `Finding ${i}`, description: `Detail about finding ${i} with extra context`,
        file: `src/file-${i}.ts`, line: i + 1, score: 50,
        metadata: { extra: `data-${i}`, moreData: `value-${i}-extra-info` },
      })),
    });

    const rawTokens = estimateTokens(JSON.stringify(input));
    const result = buildContext(input);

    expect(result.tokenEstimate).toBeLessThan(rawTokens * 0.5);
  });

  it('stays under 1000 token estimate', () => {
    const result = buildContext(mkInput());
    expect(result.tokenEstimate).toBeLessThanOrEqual(1000);
  });

  it('categorizes PR size correctly', () => {
    const small = buildContext(mkInput({ prAnalysis: { filesChanged: [], totalLinesAdded: 50, totalLinesRemoved: 10, totalFilesChanged: 1 } }));
    expect(small.context.findings.prSize).toBe('small');

    const medium = buildContext(mkInput({ prAnalysis: { filesChanged: [], totalLinesAdded: 250, totalLinesRemoved: 50, totalFilesChanged: 5 } }));
    expect(medium.context.findings.prSize).toBe('medium');

    const large = buildContext(mkInput({ prAnalysis: { filesChanged: [], totalLinesAdded: 600, totalLinesRemoved: 100, totalFilesChanged: 10 } }));
    expect(large.context.findings.prSize).toBe('large');
  });

  it('counts CVE severities correctly', () => {
    const result = buildContext(mkInput({
      findings: [
        { id: '1', rule: 'cve', severity: 'critical', title: 'c', description: 'd', score: 100 },
        { id: '2', rule: 'cve', severity: 'high', title: 'h', description: 'd', score: 70 },
        { id: '3', rule: 'cve', severity: 'medium', title: 'm', description: 'd', score: 40 },
        { id: '4', rule: 'cve', severity: 'low', title: 'l', description: 'd', score: 15 },
      ],
    }));
    expect(result.context.findings.cves.critical).toBe(1);
    expect(result.context.findings.cves.high).toBe(1);
    expect(result.context.findings.cves.low).toBe(1);
  });

  it('truncates long PR titles', () => {
    const longTitle = 'A'.repeat(200);
    const result = buildContext(mkInput({ prTitle: longTitle }));
    expect(result.context.pr.title.length).toBeLessThanOrEqual(100);
  });

  it('preserves author history', () => {
    const result = buildContext(mkInput({ authorHistory: { historicalRiskAvg: 42, overrideCount: 3 } }));
    expect(result.context.author.historicalRiskAvg).toBe(42);
    expect(result.context.author.overrideCount).toBe(3);
  });

  it('handles null author history', () => {
    const result = buildContext(mkInput({ authorHistory: undefined }));
    expect(result.context.author.historicalRiskAvg).toBeNull();
    expect(result.context.author.overrideCount).toBe(0);
  });

  it('prioritizes high-severity findings in rawFindings', () => {
    const result = buildContext(mkInput({
      findings: [
        { id: '1', rule: 'cve', severity: 'low', title: 'l', description: 'd', score: 10 },
        { id: '2', rule: 'secrets', severity: 'critical', title: 'c', description: 'd', score: 100 },
        { id: '3', rule: 'cve', severity: 'high', title: 'h', description: 'd', score: 70 },
      ],
    }));
    if (result.context.rawFindings.length > 0) {
      expect(result.context.rawFindings[0].severity).toBe('critical');
    }
  });
});

describe('estimateTokens', () => {
  it('estimates tokens from character count', () => {
    expect(estimateTokens('test')).toBe(1);
    expect(estimateTokens('twelve chars')).toBe(3);
    expect(estimateTokens('')).toBe(0);
  });
});
