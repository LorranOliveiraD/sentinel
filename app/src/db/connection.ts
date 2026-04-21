// ─────────────────────────────────────────────
// Sentinel — Conexão com Banco de Dados (Knex)
// ─────────────────────────────────────────────

import knex, { type Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import { config, isDevelopment } from '../config/index.js';
import { createChildLogger } from '../core/logger.js';

const log = createChildLogger({ service: 'database' });

let db: Knex | null = null;

/**
 * Obtém ou cria a conexão com o banco de dados.
 * Usa PostgreSQL em produção e SQLite em desenvolvimento.
 */
export function getDatabase(): Knex {
  if (db) return db;

  if (isDevelopment() || config.nodeEnv === 'test') {
    // SQLite para desenvolvimento/teste
    const sqlitePath = path.resolve(config.sqlitePath);
    const dir = path.dirname(sqlitePath);

    // Garante que o diretório de dados existe
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = knex({
      client: 'better-sqlite3',
      connection: {
        filename: sqlitePath,
      },
      useNullAsDefault: true,
    });

    log.info({ path: sqlitePath }, 'Banco de dados SQLite conectado');
  } else {
    // PostgreSQL para produção
    db = knex({
      client: 'pg',
      connection: config.databaseUrl,
      pool: {
        min: 2,
        max: 10,
      },
    });

    log.info('Banco de dados PostgreSQL conectado');
  }

  return db;
}

/**
 * Executa todas as migrações pendentes.
 */
export async function runMigrations(): Promise<void> {
  const database = getDatabase();

  try {
    log.info('Executando migrações do banco de dados...');
    await database.migrate.latest({
      directory: path.resolve(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
        'migrations'
      ),
    });
    log.info('Migrações do banco de dados concluídas');
  } catch (error) {
    log.error({ error }, 'Migração do banco de dados falhou');
    throw error;
  }
}

/**
 * Fecha a conexão com o banco de dados.
 */
export async function closeDatabase(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    log.info('Conexão com o banco de dados fechada');
  }
}
