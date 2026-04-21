// ─────────────────────────────────────────────
// Sentinel — Serviço de IA (Gemini)
// ─────────────────────────────────────────────
// ⚠️ RESTRIÇÃO: Este serviço só pode EXPLICAR achados.
//    Ele NÃO PODE decidir pass/warn/block.
//    Ele NÃO PODE ser importado pelo Motor de Política.
// ─────────────────────────────────────────────

import { GoogleGenAI } from '@google/genai';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../core/logger.js';
import type { PolicyDecision, Finding } from '../../types/policy.js';
import type { ContextReadyPayload } from '../../types/events.js';

const log = createChildLogger({ service: 'ai-service' });

/** Cliente Google GenAI (inicializado preguiçosamente) */
let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    if (!config.googleApiKey) {
      throw new Error('GOOGLE_API_KEY not configured');
    }
    client = new GoogleGenAI({ apiKey: config.googleApiKey });
  }
  return client;
}

const MODEL = 'gemini-2.5-flash';

/**
 * Gera uma explicação legível por humanos sobre os achados da política.
 *
 * Isto é chamado APENAS quando um PR é BLOQUEADO, para ajudar o desenvolvedor
 * a entender o porquê e o que corrigir. A decisão já foi tomada
 * deterministicamente pelo Motor de Política.
 *
 * @param context - Contexto mínimo do Construtor de Contexto
 * @param decision - Decisão de política (já tomada — a IA não pode mudá-la)
 * @returns String de explicação em Markdown
 */
export async function explainFindings(
  context: ContextReadyPayload['context'],
  decision: PolicyDecision
): Promise<string> {
  log.info(
    { action: decision.action, findings: decision.findings.length },
    'Gerando explicação por IA para os achados'
  );

  if (!config.googleApiKey) {
    log.warn('Chave da API Google não configurada — retornando resumo sem explicação por IA');
    return decision.summary;
  }

  try {
    const prompt = buildExplanationPrompt(context, decision);

    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: EXPLANATION_SYSTEM_PROMPT,
      },
    });

    const explanation = response.text || decision.summary;

    log.info('Explicação por IA gerada com Gemini');

    return explanation;
  } catch (error) {
    log.error({ error }, 'Falha ao gerar explicação por IA — revertendo para o resumo');
    return decision.summary;
  }
}

/**
 * Gera um relatório semanal de inteligência de engenharia.
 *
 * @param metrics - Dados de métricas DORA + comportamentais
 * @param history - Tendências históricas
 * @returns Relatório em markdown formatado
 */
export async function generateWeeklyReport(
  metrics: Record<string, unknown>,
  history: Record<string, unknown>
): Promise<string> {
  log.info('Gerando relatório semanal com Gemini');

  if (!config.googleApiKey) {
    log.warn('Chave da API Google não configurada — retornando métricas brutas');
    return `## Relatório Semanal\n\n\`\`\`json\n${JSON.stringify(metrics, null, 2)}\n\`\`\``;
  }

  try {
    const prompt = buildReportPrompt(metrics, history);

    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        systemInstruction: REPORT_SYSTEM_PROMPT,
      },
    });

    const report = response.text || `## Relatório Semanal\n\n\`\`\`json\n${JSON.stringify(metrics, null, 2)}\n\`\`\``;

    log.info('Relatório semanal gerado com Gemini');
    return report;
  } catch (error) {
    log.error({ error }, 'Falha ao gerar relatório semanal');
    return `## Relatório Semanal\n\nFalha ao gerar relatório por IA. Métricas brutas:\n\`\`\`json\n${JSON.stringify(metrics, null, 2)}\n\`\`\``;
  }
}

// ── Prompts do Sistema ──

const EXPLANATION_SYSTEM_PROMPT = `Você é o assistente de IA do Sentinel. Seu ÚNICO papel é EXPLICAR achados aos desenvolvedores.

REGRAS CRÍTICAS:
- Você NÃO PODE e NÃO DEVE decidir se um PR deve ser bloqueado, avisado ou aprovado.
- A decisão JÁ FOI TOMADA pelo Motor de Política determinístico.
- Seu trabalho é explicar POR QUE os achados são importantes e COMO corrigi-los.
- Seja conciso, prático e prestativo.
- Use formatação markdown.
- Foque nos problemas mais críticos primeiro.
- Forneça sugestões específicas de correção quando possível.`;

const REPORT_SYSTEM_PROMPT = `Você é o assistente de IA do Sentinel gerando um relatório semanal de inteligência de engenharia.

Seu trabalho é:
- Resumir as tendências das métricas DORA (frequência de implantação, tempo de lead, taxa de falha de mudança, MTTR)
- Destacar padrões comportamentais (aprovação sem revisão, concentração de revisões, taxa de override)
- Identificar tendências de risco entre os repositórios
- Fornecer recomendações práticas
- Use formatação markdown com tabelas e gráficos
- Seja orientado a dados e objetivo`;

// ── Construtores de Prompt ──

function buildExplanationPrompt(
  context: ContextReadyPayload['context'],
  decision: PolicyDecision
): string {
  const topFindings = decision.findings
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return `Um Pull Request foi analisado pelo Sentinel e o Motor de Política decidiu **${decision.action.toUpperCase()}** o mesmo.

## Contexto do PR
- **Título**: ${context.pr.title}
- **Autor**: ${context.pr.author}
- **Alterações**: +${context.pr.linesAdded} / -${context.pr.linesRemoved} em ${context.pr.filesChanged} arquivos
- **Score de Risco**: ${decision.riskScore.total}/100

## Achados (${topFindings.length} mais críticos)
${topFindings.map((f: Finding) => `- **[${f.severity.toUpperCase()}]** ${f.title}: ${f.description}`).join('\n')}

## Detalhamento do Score
${Object.entries(decision.riskScore.breakdown)
  .filter(([, score]) => score > 0)
  .map(([rule, score]) => `- ${rule}: ${score}`)
  .join('\n')}

Por favor, explique esses achados ao desenvolvedor de forma clara e prática. Foque em:
1. Por que cada achado crítico é importante
2. Passos específicos para corrigir cada problema
3. Boas práticas gerais para evitar esses problemas no futuro`;
}

function buildReportPrompt(
  metrics: Record<string, unknown>,
  history: Record<string, unknown>
): string {
  return `Gere um relatório semanal de inteligência de engenharia baseado nos seguintes dados:

## Métricas Atuais
\`\`\`json
${JSON.stringify(metrics, null, 2)}
\`\`\`

## Tendências Históricas
\`\`\`json
${JSON.stringify(history, null, 2)}
\`\`\`

Crie um relatório profissional com:
1. Resumo executivo (2-3 frases)
2. Análise das métricas DORA com tendências semanais
3. Destaques das métricas comportamentais (quaisquer padrões preocupantes)
4. Principais riscos e recomendações
5. Itens de ação para a equipe`;
}
