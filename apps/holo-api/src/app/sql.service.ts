import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolConfig } from 'pg';

// ── Interfaces ───────────────────────────────────────────

export interface SqlConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface SqlConnectionStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  connected: boolean;
  error?: string;
}

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
  description: string | null;
}

interface TableInfo {
  schema: string;
  name: string;
  description: string | null;
  columns: ColumnInfo[];
}

interface ForeignKeyInfo {
  constraintName: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
}

interface SchemaInfo {
  tables: TableInfo[];
  foreignKeys: ForeignKeyInfo[];
  lastRefreshed: number;
}

export interface SqlStatus {
  enabled: boolean;
  mode: 'query-only' | 'execute';
  connections: SqlConnectionStatus[];
  activeConnectionId: string | null;
  schemaLoaded: boolean;
}

export interface SqlQueryResult {
  query: string;
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
}

interface SqlConfig {
  enabled: boolean;
  mode: 'query-only' | 'execute';
  activeConnectionId: string | null;
  connections: SqlConnectionConfig[];
}

// ── Service ──────────────────────────────────────────────

@Injectable()
export class SqlService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger('SqlService');
  private connections: Map<string, SqlConnectionConfig> = new Map();
  private pools: Map<string, Pool> = new Map();
  private schemas: Map<string, SchemaInfo> = new Map();
  private connectionErrors: Map<string, string> = new Map();

  private enabled = false;
  private mode: 'query-only' | 'execute' = 'query-only';
  private activeConnectionId: string | null = null;

  private readonly configPath: string;
  private readonly MAX_ROWS = 20;

  constructor() {
    this.configPath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'data',
      'sql-connections.json',
    );
  }

  async onModuleInit(): Promise<void> {
    this.loadConfigSync();
    // Try to connect to saved connections in background
    for (const [id] of this.connections) {
      this.connectPool(id).catch(() => {
        /* non-blocking */
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.end().catch(() => {});
    }
    this.pools.clear();
  }

  // ── Config Persistence ─────────────────────────────────

  private loadConfigSync(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(raw) as SqlConfig;
        this.enabled = config.enabled ?? false;
        this.mode = config.mode ?? 'query-only';
        this.activeConnectionId = config.activeConnectionId ?? null;
        if (Array.isArray(config.connections)) {
          for (const conn of config.connections) {
            this.connections.set(conn.id, conn);
          }
        }
        this.logger.log(
          `Config cargada: ${this.connections.size} conexión(es), ` +
            `enabled=${this.enabled}, mode=${this.mode}`,
        );
      } else {
        this.logger.log('No hay config SQL, empezando vacío');
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Error cargando config SQL: ${(error as Error).message}`,
      );
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const config: SqlConfig = {
        enabled: this.enabled,
        mode: this.mode,
        activeConnectionId: this.activeConnectionId,
        connections: Array.from(this.connections.values()),
      };
      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2),
        'utf-8',
      );
    } catch (error: unknown) {
      this.logger.error(
        `Error guardando config SQL: ${(error as Error).message}`,
      );
    }
  }

  // ── Connection Management ──────────────────────────────

  private async connectPool(
    connectionId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const config = this.connections.get(connectionId);
    if (!config) {
      return { success: false, error: 'Conexión no encontrada' };
    }

    // Close existing pool if any
    const existing = this.pools.get(connectionId);
    if (existing) {
      await existing.end().catch(() => {});
      this.pools.delete(connectionId);
    }

    try {
      const poolConfig: PoolConfig = {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: 3,
        statement_timeout: 10000,
        connectionTimeoutMillis: 5000,
      };

      const pool = new Pool(poolConfig);

      // Test connection
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();

      this.pools.set(connectionId, pool);
      this.connectionErrors.delete(connectionId);
      this.logger.log(
        `Conectado a PostgreSQL: ${config.name} (${config.host}:${config.port}/${config.database})`,
      );

      // Read schema on successful connection
      await this.readSchema(connectionId);

      return { success: true };
    } catch (error: unknown) {
      const errMsg = (error as Error).message || 'Error desconocido';
      this.connectionErrors.set(connectionId, errMsg);
      this.logger.error(
        `Error conectando a ${config.name}: ${errMsg}`,
      );
      return { success: false, error: errMsg };
    }
  }

  async addConnection(
    config: SqlConnectionConfig,
  ): Promise<{ success: boolean; message: string }> {
    this.connections.set(config.id, config);
    const result = await this.connectPool(config.id);
    await this.saveConfig();

    if (result.success) {
      // Auto-select as active if it's the first connection
      if (!this.activeConnectionId) {
        this.activeConnectionId = config.id;
        await this.saveConfig();
      }
      return {
        success: true,
        message: `Conectado a "${config.name}" correctamente`,
      };
    }
    return {
      success: false,
      message: result.error || 'Error de conexión',
    };
  }

  async removeConnection(connectionId: string): Promise<void> {
    const pool = this.pools.get(connectionId);
    if (pool) {
      await pool.end().catch(() => {});
      this.pools.delete(connectionId);
    }
    this.connections.delete(connectionId);
    this.schemas.delete(connectionId);
    this.connectionErrors.delete(connectionId);

    if (this.activeConnectionId === connectionId) {
      // Pick next available or null
      const remaining = Array.from(this.connections.keys());
      this.activeConnectionId = remaining.length > 0 ? remaining[0] : null;
    }
    await this.saveConfig();
    this.logger.log(`Conexión ${connectionId} eliminada`);
  }

  async testConnection(
    connectionId: string,
  ): Promise<{ success: boolean; message: string }> {
    const pool = this.pools.get(connectionId);
    if (!pool) {
      // Try to reconnect
      const result = await this.connectPool(connectionId);
      return {
        success: result.success,
        message: result.success ? 'Conexión OK' : result.error || 'Error',
      };
    }
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      return { success: true, message: 'Conexión OK' };
    } catch (error: unknown) {
      return {
        success: false,
        message: (error as Error).message || 'Error',
      };
    }
  }

  // ── Schema Reading ─────────────────────────────────────

  private async readSchema(connectionId: string): Promise<void> {
    const pool = this.pools.get(connectionId);
    if (!pool) return;

    try {
      const client = await pool.connect();

      // Use longer timeout for schema reading (large ERP databases)
      await client.query('SET statement_timeout = 60000'); // 60 seconds

      // Get columns with descriptions from pg_catalog
      const columnsResult = await client.query(`
        SELECT n.nspname AS table_schema, c.relname AS table_name,
               a.attname AS column_name,
               format_type(a.atttypid, a.atttypmod) AS data_type,
               NOT a.attnotnull AS is_nullable,
               pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
               d.description AS col_description
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
        LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND c.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND c.relname NOT LIKE 'pg_%'
        ORDER BY n.nspname, c.relname, a.attnum
      `);

      // Get table descriptions
      const tableDescResult = await client.query(`
        SELECT n.nspname AS table_schema, c.relname AS table_name, d.description
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND c.relkind = 'r'
          AND c.relname NOT LIKE 'pg_%'
          AND d.description IS NOT NULL
      `);

      // Get primary keys
      const pkResult = await client.query(`
        SELECT tc.table_schema, tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `);

      // Get foreign keys
      const fkResult = await client.query(`
        SELECT tc.constraint_name,
               tc.table_name AS source_table,
               kcu.column_name AS source_column,
               ccu.table_name AS target_table,
               ccu.column_name AS target_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
          AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      `);

      // Reset timeout back to pool default
      await client.query('RESET statement_timeout');
      client.release();

      // Build table descriptions map
      const tableDescMap = new Map<string, string>();
      for (const row of tableDescResult.rows) {
        tableDescMap.set(
          `${row.table_schema}.${row.table_name}`,
          row.description,
        );
      }

      // Build primary keys set
      const pkSet = new Set<string>();
      for (const row of pkResult.rows) {
        pkSet.add(`${row.table_schema}.${row.table_name}.${row.column_name}`);
      }

      // Build tables map
      const tablesMap = new Map<string, TableInfo>();
      for (const row of columnsResult.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!tablesMap.has(key)) {
          tablesMap.set(key, {
            schema: row.table_schema,
            name: row.table_name,
            description: tableDescMap.get(key) || null,
            columns: [],
          });
        }
        tablesMap.get(key)!.columns.push({
          name: row.column_name,
          dataType: row.data_type,
          isNullable: row.is_nullable,
          columnDefault: row.column_default,
          isPrimaryKey: pkSet.has(
            `${row.table_schema}.${row.table_name}.${row.column_name}`,
          ),
          description: row.col_description || null,
        });
      }

      // Build foreign keys
      const foreignKeys: ForeignKeyInfo[] = fkResult.rows.map((row) => ({
        constraintName: row.constraint_name,
        sourceTable: row.source_table,
        sourceColumn: row.source_column,
        targetTable: row.target_table,
        targetColumn: row.target_column,
      }));

      this.schemas.set(connectionId, {
        tables: Array.from(tablesMap.values()),
        foreignKeys,
        lastRefreshed: Date.now(),
      });

      this.logger.log(
        `Esquema leído: ${tablesMap.size} tablas, ${foreignKeys.length} FKs`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Error leyendo esquema: ${(error as Error).message}`,
      );
    }
  }

  async refreshSchema(
    connectionId: string,
  ): Promise<{ success: boolean; message: string }> {
    const pool = this.pools.get(connectionId);
    if (!pool) {
      // Try reconnecting first
      const connectResult = await this.connectPool(connectionId);
      if (!connectResult.success) {
        return {
          success: false,
          message: connectResult.error || 'No se pudo conectar',
        };
      }
    }

    try {
      await this.readSchema(connectionId);
      const schema = this.schemas.get(connectionId);
      return {
        success: true,
        message: `Esquema actualizado: ${schema?.tables.length ?? 0} tablas`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: (error as Error).message || 'Error',
      };
    }
  }

  // ── Schema as Text (for LLM injection) ────────────────

  /** Get full schema (for small DBs only) */
  getSchemaAsText(): string | null {
    return this.getFilteredSchema(null);
  }

  /** Get schema filtered by user message keywords, ultra-compact for token savings */
  getFilteredSchema(userMessage: string | null): string | null {
    if (!this.activeConnectionId) return null;

    const schema = this.schemas.get(this.activeConnectionId);
    if (!schema || schema.tables.length === 0) return null;

    const config = this.connections.get(this.activeConnectionId);
    const dbName = config?.database ?? 'db';

    const MAX_TABLES = 15;

    // For large schemas, filter relevant tables by keyword matching
    let relevantTables = schema.tables;

    if (schema.tables.length > MAX_TABLES && userMessage) {
      const keywords = this.extractKeywords(userMessage);
      this.logger.debug(`SQL keywords: [${keywords.join(', ')}]`);

      // Score tables: descriptions > table names > column names
      const scored = schema.tables.map((table) => {
        let score = 0;
        const tName = table.name.toLowerCase();
        const tDesc = (table.description || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

        for (const kw of keywords) {
          if (tDesc.includes(kw)) score += 15;
          if (tName.includes(kw)) score += 10;
          for (const col of table.columns) {
            const cDesc = (col.description || '')
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase();
            if (col.name.toLowerCase().includes(kw)) score += 3;
            if (cDesc.includes(kw)) score += 5;
          }
        }
        return { table, score };
      });

      relevantTables = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_TABLES)
        .map((s) => s.table);

      this.logger.debug(
        `SQL filter: ${relevantTables.length}/${schema.tables.length} tables`,
      );
    } else if (schema.tables.length > MAX_TABLES) {
      // No userMessage, just take first MAX_TABLES
      relevantTables = schema.tables.slice(0, MAX_TABLES);
    }

    // Build ultra-compact schema text
    // Format: "table_name (desc): col1 type "desc", col2 type PK"
    const lines: string[] = [`DB:${dbName} (${relevantTables.length}/${schema.tables.length} tablas)`];

    for (const table of relevantTables) {
      const desc = table.description ? ` -- ${table.description}` : '';
      const cols = table.columns.map((col) => {
        let s = `${col.name} ${col.dataType}`;
        if (col.isPrimaryKey) s += ' PK';
        if (col.description) s += ` "${col.description}"`;
        return s;
      });
      lines.push(`${table.name}${desc}: ${cols.join(', ')}`);
    }

    return lines.join('\n');
  }

  /** Get total table count */
  getTableCount(): number {
    if (!this.activeConnectionId) return 0;
    const schema = this.schemas.get(this.activeConnectionId);
    return schema?.tables.length ?? 0;
  }

  /** Extract search keywords from user message, with stemming for Spanish */
  private extractKeywords(message: string): string[] {
    // Remove accents
    const normalized = message
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    // Common stop words in Spanish
    const stopWords = new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
      'de', 'del', 'en', 'con', 'por', 'para', 'al', 'a',
      'y', 'o', 'que', 'se', 'es', 'son', 'hay', 'fue',
      'como', 'mas', 'pero', 'si', 'no', 'me', 'te', 'le',
      'lo', 'su', 'sus', 'mi', 'mis', 'tu', 'tus',
      'este', 'esta', 'estos', 'estas', 'ese', 'esa',
      'cual', 'cuales', 'cuanto', 'cuantos', 'cuantas',
      'quiero', 'saber', 'decime', 'mostrame', 'dame',
      'tiene', 'tienen', 'tener', 'hacer', 'hizo',
      'todos', 'todas', 'todo', 'toda', 'cada', 'otro',
    ]);

    // Split and filter
    const words = normalized
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // Generate stems: strip common Spanish suffixes to match ERP table names
    // e.g. "vendedores" → ["vendedores", "vendedor", "vended", "vende", "vend"]
    // e.g. "depositos" → ["depositos", "deposito", "deposit", "deposi", "depos"]
    // e.g. "facturas" → ["facturas", "factura", "factur", "fact"]
    const allKeywords = new Set<string>();
    for (const word of words) {
      allKeywords.add(word);
      // Strip plural/common endings progressively
      const stems = this.getStems(word);
      for (const stem of stems) {
        if (stem.length >= 4) {
          allKeywords.add(stem);
        }
      }
    }

    return [...allKeywords];
  }

  /** Basic Spanish stemming: generate progressively shorter stems */
  private getStems(word: string): string[] {
    const stems: string[] = [];
    let w = word;

    // Strip common Spanish suffixes
    const suffixes = [
      'iones', 'cion', 'dores', 'doras', 'ores', 'oras',
      'eros', 'eras', 'ajes', 'ajes', 'ados', 'adas',
      'idos', 'idas', 'bles', 'mente', 'ando', 'endo',
      'ores', 'oras', 'ajes', 'ies', 'es', 'os', 'as',
      'or', 'er', 'ar', 'ir', 'al', 'on', 'a', 'o', 's',
    ];

    for (const suffix of suffixes) {
      if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
        stems.push(w.slice(0, -suffix.length));
      }
    }

    // Also add truncated versions (4+ chars) for fuzzy matching
    // ERP tables often use abbreviated names like "vend", "depo", "fact"
    if (w.length > 5) {
      for (let len = w.length - 1; len >= Math.min(4, w.length); len--) {
        stems.push(w.slice(0, len));
      }
    }

    return stems;
  }

  // ── Query Execution ────────────────────────────────────

  async executeQuery(query: string): Promise<SqlQueryResult> {
    if (this.mode !== 'execute') {
      return { query, error: 'Modo ejecución no habilitado' };
    }

    if (!this.activeConnectionId) {
      return { query, error: 'No hay conexión activa' };
    }

    const pool = this.pools.get(this.activeConnectionId);
    if (!pool) {
      return { query, error: 'Pool no disponible' };
    }

    // Security: reject write operations
    const trimmed = query.trim().toUpperCase();
    const forbidden = [
      'INSERT',
      'UPDATE',
      'DELETE',
      'DROP',
      'ALTER',
      'TRUNCATE',
      'CREATE',
      'GRANT',
      'REVOKE',
    ];
    for (const keyword of forbidden) {
      if (trimmed.startsWith(keyword)) {
        return {
          query,
          error: `Operación no permitida: ${keyword}. Solo se permiten consultas SELECT/WITH.`,
        };
      }
    }

    // Apply LIMIT if missing
    let safeQuery = query.trim();
    if (safeQuery.endsWith(';')) {
      safeQuery = safeQuery.slice(0, -1).trim();
    }
    const upperQuery = safeQuery.toUpperCase();
    if (!upperQuery.includes('LIMIT')) {
      safeQuery = `${safeQuery} LIMIT ${this.MAX_ROWS}`;
    }

    try {
      const client = await pool.connect();
      const result = await client.query(safeQuery);
      client.release();

      const truncated = result.rows.length >= this.MAX_ROWS;

      return {
        query: safeQuery,
        rows: result.rows,
        rowCount: result.rows.length,
        truncated,
      };
    } catch (error: unknown) {
      return {
        query: safeQuery,
        error: (error as Error).message || 'Error ejecutando query',
      };
    }
  }

  // ── Setters ────────────────────────────────────────────

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await this.saveConfig();
    this.logger.log(`SQL Agent ${enabled ? 'habilitado' : 'deshabilitado'}`);
  }

  async setMode(mode: 'query-only' | 'execute'): Promise<void> {
    this.mode = mode;
    await this.saveConfig();
    this.logger.log(`SQL mode: ${mode}`);
  }

  async setActiveConnection(connectionId: string | null): Promise<void> {
    this.activeConnectionId = connectionId;
    await this.saveConfig();
    this.logger.log(`Conexión activa: ${connectionId}`);
  }

  // ── Getters ────────────────────────────────────────────

  isEnabled(): boolean {
    return this.enabled;
  }

  getMode(): 'query-only' | 'execute' {
    return this.mode;
  }

  hasActiveSchema(): boolean {
    if (!this.activeConnectionId) return false;
    const schema = this.schemas.get(this.activeConnectionId);
    return !!schema && schema.tables.length > 0;
  }

  getStatus(): SqlStatus {
    const connections: SqlConnectionStatus[] = [];
    for (const [id, config] of this.connections) {
      connections.push({
        id,
        name: config.name,
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        connected: this.pools.has(id) && !this.connectionErrors.has(id),
        error: this.connectionErrors.get(id),
      });
    }

    return {
      enabled: this.enabled,
      mode: this.mode,
      connections,
      activeConnectionId: this.activeConnectionId,
      schemaLoaded: this.hasActiveSchema(),
    };
  }
}
