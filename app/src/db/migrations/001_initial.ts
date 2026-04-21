// ─────────────────────────────────────────────
// Sentinel — Migração Inicial do Banco de Dados
// ─────────────────────────────────────────────

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Tabela de Análises de PR ──
  await knex.schema.createTable('pr_analyses', (table) => {
    table.increments('id').primary();
    table.string('correlation_id').notNullable().unique();
    table.string('repo_owner').notNullable();
    table.string('repo_name').notNullable();
    table.string('repo_full_name').notNullable().index();
    table.integer('pr_number').notNullable();
    table.string('pr_title').notNullable();
    table.string('pr_author').notNullable().index();
    table.string('action').notNullable(); // pass | warn | block
    table.integer('risk_score').notNullable();
    table.json('risk_breakdown').notNullable();
    table.json('findings').notNullable();
    table.json('rule_results').notNullable();
    table.text('summary');
    table.text('ai_explanation');
    table.integer('lines_added').defaultTo(0);
    table.integer('lines_removed').defaultTo(0);
    table.integer('files_changed').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Índice composto para consultas de repo + PR
    table.index(['repo_full_name', 'pr_number']);
  });

  // ── Tabela de Logs de Override (trilha de auditoria) ──
  await knex.schema.createTable('override_logs', (table) => {
    table.increments('id').primary();
    table.string('repo_full_name').notNullable().index();
    table.integer('pr_number').notNullable();
    table.string('author').notNullable().index();
    table.text('reason').notNullable();
    table.integer('comment_id');
    table.integer('original_risk_score');
    table.string('original_action');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Para consultas de auditoria
    table.index(['repo_full_name', 'pr_number']);
    table.index(['author', 'created_at']);
  });

  // ── Tabela de Perfis de Desenvolvedores ──
  await knex.schema.createTable('dev_profiles', (table) => {
    table.increments('id').primary();
    table.string('username').notNullable().unique();
    table.integer('total_analyses').defaultTo(0);
    table.float('average_risk_score').defaultTo(0);
    table.integer('last_risk_score').defaultTo(0);
    table.integer('override_count').defaultTo(0);
    table.json('risk_score_history'); // Array dos últimos 50 scores
    table.timestamp('last_analyzed_at');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // ── Tabela de Snapshots de Métricas ──
  await knex.schema.createTable('metric_snapshots', (table) => {
    table.increments('id').primary();
    table.string('period').notNullable(); // 'weekly' | 'monthly'
    table.string('repo_full_name'); // null = global
    table.json('dora_metrics').notNullable();
    table.json('behavioral_metrics').notNullable();
    table.text('summary');
    table.text('ai_report');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['period', 'created_at']);
    table.index(['repo_full_name', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('metric_snapshots');
  await knex.schema.dropTableIfExists('dev_profiles');
  await knex.schema.dropTableIfExists('override_logs');
  await knex.schema.dropTableIfExists('pr_analyses');
}
