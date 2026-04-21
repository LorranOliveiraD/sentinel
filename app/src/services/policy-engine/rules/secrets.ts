// ─────────────────────────────────────────────
// Sentinel V3 — Regra de Detecção de Segredos
// ─────────────────────────────────────────────
// DETERMINÍSTICO — IA não permitida neste módulo
// ─────────────────────────────────────────────

import type { RuleEvaluator, RuleInput, RuleResult, Finding } from '../../../types/policy.js';
import { isSecretExcludedFile } from '../../../utils/file-patterns.js';

/** Padrões de segredos embutidos com classificações de severidade */
const SECRET_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  severity: Finding['severity'];
  score: number;
}> = [
  // AWS
  {
    name: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: 'critical',
    score: 100,
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/g,
    severity: 'critical',
    score: 100,
  },

  // GitHub
  {
    name: 'GitHub Token',
    pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g,
    severity: 'critical',
    score: 100,
  },
  {
    name: 'GitHub OAuth',
    pattern: /gho_[A-Za-z0-9_]{36,}/g,
    severity: 'critical',
    score: 100,
  },

  // Chaves genéricas de API
  {
    name: 'Generic API Key',
    pattern: /(?:api_key|apikey|api-key|API_KEY)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{20,})['"]?/gi,
    severity: 'high',
    score: 80,
  },
  {
    name: 'Generic Secret',
    pattern: /(?:secret|SECRET|password|PASSWORD|passwd|PASSWD)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/g,
    severity: 'high',
    score: 80,
  },

  // Tokens
  {
    name: 'Bearer Token',
    pattern: /(?:bearer|Bearer)\s+[A-Za-z0-9\-._~+/]+=*/g,
    severity: 'high',
    score: 70,
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'critical',
    score: 100,
  },

  // Slack
  {
    name: 'Slack Token',
    pattern: /xox[bporas]-[A-Za-z0-9-]{10,}/g,
    severity: 'critical',
    score: 100,
  },

  // Anthropic
  {
    name: 'Anthropic API Key',
    pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    severity: 'critical',
    score: 100,
  },

  // Google
  {
    name: 'Google API Key',
    pattern: /AIza[0-9A-Za-z\-_]{35}/g,
    severity: 'high',
    score: 80,
  },

  // URLs de banco de dados com credenciais
  {
    name: 'Database URL with Password',
    pattern: /(?:postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/g,
    severity: 'high',
    score: 80,
  },
];

/**
 * Padrões que indicam que um valor é uma referência a variável de ambiente
 * ou chamada de função, e não um segredo real (falso positivo).
 */
const FALSE_POSITIVE_PATTERNS: RegExp[] = [
  /^process\.env\./,                   // Referência a env var do Node.js
  /^\$\{/,                             // Template string com interpolação
  /^\$[A-Z_]/,                         // Referência a env var do shell
  /^env\(/,                            // Chamada de função env()
  /^os\.environ/,                      // Python os.environ
  /^ENV\[/,                            // Ruby ENV
  /^getenv\(/,                         // PHP getenv
  /^your_/i,                           // Placeholder: "your_key_here"
  /^<.*>$/,                            // Placeholder: "<your-key>"
  /^xxx/i,                             // Placeholder: "xxx..."
  /^changeme/i,                        // Placeholder: "changeme"
  /^TODO/i,                            // Placeholder: "TODO"
  /^REPLACE/i,                         // Placeholder: "REPLACE_ME"
];

/**
 * Avaliador de Regra de Segredos
 *
 * Escaneia patches de diff por segredos hardcoded, chaves de API e credenciais.
 * Escaneia apenas linhas ADICIONADAS (linhas começando com +) para evitar falsos
 * positivos de código removido.
 */
export class SecretsRule implements RuleEvaluator {
  readonly category = 'secrets' as const;

  evaluate(input: RuleInput): RuleResult {
    const findings: Finding[] = [];

    for (const file of input.prAnalysis.filesChanged) {
      // Pula arquivos excluídos
      if (isSecretExcludedFile(file.filename)) continue;

      // Escaneia apenas patches (linhas adicionadas)
      if (!file.patch) continue;

      const addedLines = file.patch
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

      const addedContent = addedLines.join('\n');

      for (const pattern of SECRET_PATTERNS) {
        // Cria um novo RegExp para evitar problemas com lastIndex em uso concorrente
        const freshPattern = new RegExp(pattern.pattern.source, pattern.pattern.flags);

        const matches = addedContent.matchAll(freshPattern);

        for (const match of matches) {
          // match[1] contém o segredo limpo se houver grupo de captura na Regex
          // match[0] é o fallback para regex simples (como a do GitHub)
          const rawSecret = match[1] || match[0];

          // Falso positivo: Verifica se o valor é uma referência a variável/função
          if (isFalsePositive(rawSecret, pattern.name)) {
            continue;
          }

          findings.push({
            id: `secrets-${findings.length + 1}`,
            rule: 'secrets',
            severity: pattern.severity,
            title: `Potencial ${pattern.name} detectado`,
            description: `Encontrado um padrão correspondente a "${pattern.name}" em ${file.filename}. Segredos embutidos (hardcoded) nunca devem ser commitados no controle de versão.`,
            file: file.filename,
            score: pattern.score,
            metadata: {
              patternName: pattern.name,
              matchPreview: maskSecret(rawSecret),
            },
          });
        }
      }
    }

    const totalScore = findings.reduce((sum, f) => sum + f.score, 0);

    return {
      rule: 'secrets',
      findings,
      score: Math.min(totalScore, 100), // Limitado a 100
      passed: findings.length === 0,
    };
  }
}

/**
 * Verifica se um valor detectado é um falso positivo.
 *
 * Heurísticas:
 * 1. Referências a variáveis de ambiente (process.env, ${}, $VAR)
 * 2. Chamadas de função (env(), getenv(), os.environ)
 * 3. Placeholders (your_, <key>, xxx, changeme, TODO)
 * 4. Padrões genéricos sem entropia (apenas letras, sem números)
 */
function isFalsePositive(value: string, patternName: string): boolean {
  // Checa contra padrões de falso positivo conhecidos
  if (FALSE_POSITIVE_PATTERNS.some((fp) => fp.test(value))) {
    return true;
  }

  // Para padrões genéricos: se não tem nenhum número, provavelmente é nome de variável
  if (patternName.includes('Generic') && !/\d/.test(value)) {
    return true;
  }

  return false;
}

/**
 * Mascara um valor de segredo para logging seguro, mostrando apenas os 3 primeiros e últimos caracteres.
 */
function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length); // Esconde tudo se for pequeno
  return value.substring(0, 3) + '...' + value.substring(value.length - 3); // Deixa 3 e 3
}
