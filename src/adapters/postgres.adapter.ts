import { BaseAdapter } from './base.adapter.js';
import { EdgeMappingConfig, EdgeRecord, NodeMappingConfig, NodeRecord, PostgresSourceConfig } from '../types.js';
import { quotePostgresIdentifier, validateIdentifier } from '../utils/security.js';

export class PostgresAdapter extends BaseAdapter {
  readonly name = 'PostgresAdapter';
  private config: PostgresSourceConfig;
  private pool: any = null;

  constructor(config: PostgresSourceConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    if (this.pool) return;

    let pg: any;
    try {
      pg = await import('pg');
    } catch {
      throw new Error(
        'The "pg" package is required to use PostgresAdapter. Please install it with: npm install pg'
      );
    }

    const { Pool } = pg.default || pg;

    if (this.config.uri) {
      this.pool = new Pool({ connectionString: this.config.uri });
    } else if (this.config.connection) {
      this.pool = new Pool(this.config.connection);
    } else {
      throw new Error('PostgresAdapter requires either "uri" or "connection" configuration.');
    }

    // Verify connectivity
    const client = await this.pool.connect();
    client.release();
  }

  public async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  public async fetchNodes(
    entityType: string,
    config: NodeMappingConfig,
    sinceTimestamp?: number
  ): Promise<NodeRecord[]> {
    // Validate identifiers first before database interaction
    const quotedTable = quotePostgresIdentifier(config.table);
    const idCol = config.id ? validateIdentifier(config.id) : 'id';
    const attributes = config.attributes.map((attr) => validateIdentifier(attr));
    const allCols = Array.from(new Set([idCol, ...attributes]));
    if (config.updatedAt) {
      allCols.push(validateIdentifier(config.updatedAt));
    }
    const quotedCols = allCols.map((col) => quotePostgresIdentifier(col)).join(', ');

    if (!this.pool) {
      await this.connect();
    }

    let query = `SELECT ${quotedCols} FROM ${quotedTable}`;
    const params: any[] = [];

    if (sinceTimestamp && config.updatedAt) {
      query += ` WHERE ${quotePostgresIdentifier(config.updatedAt)} > to_timestamp($1)`;
      params.push(sinceTimestamp / 1000);
    }

    const res = await this.pool.query(query, params);

    return res.rows.map((row: Record<string, any>) => {
      const id = String(row[idCol]);
      const attrs: Record<string, any> = {};
      for (const attr of attributes) {
        attrs[attr] = row[attr];
      }
      const updatedAt = config.updatedAt && row[config.updatedAt]
        ? new Date(row[config.updatedAt]).getTime()
        : Date.now();

      return {
        id,
        entityType,
        attributes: attrs,
        searchText: this.buildSearchText(attrs),
        updatedAt
      };
    });
  }

  public async fetchEdges(
    edgeType: string,
    config: EdgeMappingConfig,
    sinceTimestamp?: number
  ): Promise<EdgeRecord[]> {
    const quotedTable = quotePostgresIdentifier(config.table);
    const cols = [quotePostgresIdentifier(config.sourceId), quotePostgresIdentifier(config.targetId)];
    if (typeof config.weight === 'string') {
      cols.push(quotePostgresIdentifier(config.weight));
    }
    if (config.updatedAt) {
      cols.push(quotePostgresIdentifier(config.updatedAt));
    }

    if (!this.pool) {
      await this.connect();
    }

    let query = `SELECT ${cols.join(', ')} FROM ${quotedTable}`;
    const params: any[] = [];

    if (sinceTimestamp && config.updatedAt) {
      query += ` WHERE ${quotePostgresIdentifier(config.updatedAt)} > to_timestamp($1)`;
      params.push(sinceTimestamp / 1000);
    }

    const res = await this.pool.query(query, params);

    return res.rows.map((row: Record<string, any>) => {
      let weight = 1.0;
      if (typeof config.weight === 'number') {
        weight = config.weight;
      } else if (typeof config.weight === 'string' && row[config.weight] !== undefined) {
        weight = Number(row[config.weight]) || 1.0;
      }

      const updatedAt = config.updatedAt && row[config.updatedAt]
        ? new Date(row[config.updatedAt]).getTime()
        : Date.now();

      return {
        sourceId: String(row[config.sourceId]),
        targetId: String(row[config.targetId]),
        edgeType,
        weight,
        updatedAt
      };
    });
  }
}
