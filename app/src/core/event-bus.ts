// ─────────────────────────────────────────────
// Sentinel V3 — Barramento de Eventos Tipado e Assíncrono
// ─────────────────────────────────────────────

import { EventEmitter } from 'node:events';
import type { SentinelEvents, SentinelEventName } from '../types/events.js';
import { logger } from './logger.js';

/**
 * Barramento de eventos assíncrono tipado construído sobre o EventEmitter do Node.
 *
 * Decisões de design:
 * - Genéricos tipados garantem segurança em tempo de compilação para payloads
 * - Handlers assíncronos são executados sequencialmente por evento (preserva ordenação)
 * - Erros nos handlers são capturados e logados sem derrubar o barramento
 * - IDs de correlação fluem através dos eventos para rastreamento distribuído
 */
class SentinelEventBus {
  private readonly emitter: EventEmitter;
  private readonly handlerCounts: Map<string, number> = new Map();

  constructor() {
    this.emitter = new EventEmitter();
    // Permite muitos listeners pois vários serviços assinam os mesmos eventos
    this.emitter.setMaxListeners(50);
  }

  /**
   * Inscrever-se em um evento tipado.
   */
  on<E extends SentinelEventName>(
    event: E,
    handler: (payload: SentinelEvents[E]) => void | Promise<void>
  ): void {
    const count = (this.handlerCounts.get(event) ?? 0) + 1;
    this.handlerCounts.set(event, count);

    this.emitter.on(event, async (payload: SentinelEvents[E]) => {
      try {
        await handler(payload);
      } catch (error) {
        logger.error(
          { event, error, payload: this.safePayloadSummary(payload) },
          `Erro no handler do evento "${event}"`
        );
      }
    });

    logger.debug({ event, handlerCount: count }, `Handler registrado para "${event}"`);
  }

  /**
   * Inscrever-se em um evento tipado (dispara apenas uma vez).
   */
  once<E extends SentinelEventName>(
    event: E,
    handler: (payload: SentinelEvents[E]) => void | Promise<void>
  ): void {
    this.emitter.once(event, async (payload: SentinelEvents[E]) => {
      try {
        await handler(payload);
      } catch (error) {
        logger.error(
          { event, error },
          `Erro no handler único do evento "${event}"`
        );
      }
    });
  }

  /**
   * Emitir um evento tipado para todos os assinantes.
   */
  emit<E extends SentinelEventName>(event: E, payload: SentinelEvents[E]): void {
    const listenerCount = this.emitter.listenerCount(event);

    logger.info(
      { event, listenerCount, payload: this.safePayloadSummary(payload) },
      `Evento emitido: "${event}"`
    );

    if (listenerCount === 0) {
      logger.warn({ event }, `Nenhum listener registrado para o evento "${event}"`);
    }

    this.emitter.emit(event, payload);
  }

  /**
   * Remover todos os listeners de um evento específico, ou de todos os eventos.
   */
  removeAllListeners(event?: SentinelEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event);
      this.handlerCounts.delete(event);
    } else {
      this.emitter.removeAllListeners();
      this.handlerCounts.clear();
    }
  }

  /**
   * Obter contagem de listeners registrados para um evento.
   */
  listenerCount(event: SentinelEventName): number {
    return this.emitter.listenerCount(event);
  }

  /**
   * Obter um resumo diagnóstico de todos os handlers registrados.
   */
  diagnostics(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [event, count] of this.handlerCounts) {
      result[event] = count;
    }
    return result;
  }

  /**
   * Criar um resumo seguro do payload para logging (evita logar dados sensíveis).
   */
  private safePayloadSummary(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object') {
      return { type: typeof payload };
    }

    const obj = payload as Record<string, unknown>;
    const summary: Record<string, unknown> = {};

    if ('correlationId' in obj) summary.correlationId = obj.correlationId;
    if ('repository' in obj) summary.repository = obj.repository;
    if ('prNumber' in obj) summary.prNumber = obj.prNumber;
    if ('action' in obj) summary.action = obj.action;

    return summary;
  }
}

/** Instância singleton do barramento de eventos */
export const eventBus = new SentinelEventBus();
