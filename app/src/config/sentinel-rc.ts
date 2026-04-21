// ─────────────────────────────────────────────
// Sentinel V3 — Parser do .sentinelrc.yml
// ─────────────────────────────────────────────

import fs from 'node:fs';
import yaml from 'js-yaml';
import { SENTINEL_RC_DEFAULTS, type SentinelRcConfig } from '../types/config.js';
import { logger } from '../core/logger.js';

/**
 * Carrega e faz parse de um arquivo .sentinelrc.yml, mesclando com os padrões.
 *
 * @param filePath - Caminho absoluto para o arquivo .sentinelrc.yml
 * @returns Configuração mesclada
 */
export function loadSentinelRc(filePath?: string): SentinelRcConfig {
  if (!filePath || !fs.existsSync(filePath)) {
    logger.info('Nenhum .sentinelrc.yml encontrado, usando padrões');
    return { ...SENTINEL_RC_DEFAULTS };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Partial<SentinelRcConfig> | null;

    if (!parsed || typeof parsed !== 'object') {
      logger.warn('Conteúdo do .sentinelrc.yml inválido, usando padrões');
      return { ...SENTINEL_RC_DEFAULTS };
    }

    const merged = mergeWithDefaults(parsed);
    validateConfig(merged);

    logger.info({ config: merged }, '.sentinelrc.yml carregado com sucesso');
    return merged;
  } catch (error) {
    logger.error({ error }, 'Falha ao fazer parse do .sentinelrc.yml, usando padrões');
    return { ...SENTINEL_RC_DEFAULTS };
  }
}

/**
 * Mescla a configuração do usuário com os padrões.
 * Valores do usuário sobrescrevem padrões; arrays são substituídos, não mesclados.
 */
function mergeWithDefaults(partial: Partial<SentinelRcConfig>): SentinelRcConfig {
  return {
    riskScoreWarn: partial.riskScoreWarn ?? SENTINEL_RC_DEFAULTS.riskScoreWarn,
    riskScoreBlock: partial.riskScoreBlock ?? SENTINEL_RC_DEFAULTS.riskScoreBlock,
    minTestCoverage: partial.minTestCoverage ?? SENTINEL_RC_DEFAULTS.minTestCoverage,
    largePRLines: partial.largePRLines ?? SENTINEL_RC_DEFAULTS.largePRLines,
    enabledRules: partial.enabledRules ?? SENTINEL_RC_DEFAULTS.enabledRules,
    disabledRules: partial.disabledRules ?? SENTINEL_RC_DEFAULTS.disabledRules,
    excludePatterns: partial.excludePatterns ?? SENTINEL_RC_DEFAULTS.excludePatterns,
    customSecretPatterns: partial.customSecretPatterns ?? SENTINEL_RC_DEFAULTS.customSecretPatterns,
  };
}

/**
 * Valida se os valores de configuração estão dentro de intervalos aceitáveis.
 * Lança erro para valores inválidos.
 */
function validateConfig(config: SentinelRcConfig): void {
  if (config.riskScoreWarn < 0 || config.riskScoreWarn > 100) {
    throw new Error(`risk_score_warn deve ser 0-100, recebido ${config.riskScoreWarn}`);
  }
  if (config.riskScoreBlock < 0 || config.riskScoreBlock > 100) {
    throw new Error(`risk_score_block deve ser 0-100, recebido ${config.riskScoreBlock}`);
  }
  if (config.riskScoreWarn >= config.riskScoreBlock) {
    throw new Error(
      `risk_score_warn (${config.riskScoreWarn}) deve ser menor que risk_score_block (${config.riskScoreBlock})`
    );
  }
  if (config.largePRLines <= 0) {
    throw new Error(`large_pr_lines deve ser positivo, recebido ${config.largePRLines}`);
  }
  if (config.minTestCoverage < 0 || config.minTestCoverage > 100) {
    throw new Error(`min_test_coverage deve ser 0-100, recebido ${config.minTestCoverage}`);
  }
}

/**
 * Faz parse do .sentinelrc.yml a partir de conteúdo string bruto (útil para buscar da API do GitHub).
 */
export function parseSentinelRcContent(content: string): SentinelRcConfig {
  try {
    const parsed = yaml.load(content) as Partial<SentinelRcConfig> | null;

    if (!parsed || typeof parsed !== 'object') {
      return { ...SENTINEL_RC_DEFAULTS };
    }

    const merged = mergeWithDefaults(parsed);
    validateConfig(merged);
    return merged;
  } catch (error) {
    logger.error({ error }, 'Falha ao fazer parse do conteúdo do .sentinelrc.yml');
    return { ...SENTINEL_RC_DEFAULTS };
  }
}
