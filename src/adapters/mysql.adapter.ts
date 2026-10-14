import { BaseAdapter } from './base.adapter.js';
import { EdgeMappingConfig, EdgeRecord, MySQLSourceConfig, NodeMappingConfig, NodeRecord } from '../types.js';
import { quoteMySQLIdentifier, validateIdentifier } from '../utils/security.js';

export class MySQLAdapter extends BaseAdapter {
  readonly name = 'MySQLAdapter';
  private config: MySQLSourceConfig;
  private pool: any = null;

  constructor(config: MySQLSourceConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    if (this.pool) return;

    let mysql: any;
    try {
      mysql = await import('mysql2/promise');
    } catch {
      throw new Error(
        'The "mysql2" package is required to use MySQLAdapter. Please install it with: npm install mysql2'
      );
    }

    const createPool = mysql.createPool || mysql.default?.createPool;

    if (this.config.uri) {
      this.pool = createPool(this.config.uri);
    } else if (this.config.connection) {
      this.pool = createPool(this.config.connection);
    } else {
      throw new Error('MySQLAdapter requires either "uri" or "connection" configuration.');
    }

    const conn = await this.pool.getConnection();
    conn.release();
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
    const quotedTable = quoteMySQLIdentifier(config.table);
    const idCol = config.id ? validateIdentifier(config.id) : 'id';
    const attributes = config.attributes.map((attr) => validateIdentifier(attr));
    const allCols = Array.from(new Set([idCol, ...attributes]));
    if (config.updatedAt) {
      allCols.push(validateIdentifier(config.updatedAt));
    }
    const quotedCols = allCols.map((col) => quoteMySQLIdentifier(col)).join(', ');

    if (!this.pool) {
      await this.connect();
    }

    let query = `SELECT ${quotedCols} FROM ${quotedTable}`;
    const params: any[] = [];

    if (sinceTimestamp && config.updatedAt) {
      query += ` WHERE ${quoteMySQLIdentifier(config.updatedAt)} > FROM_UNIXTIME(?)`;
      params.push(Math.floor(sinceTimestamp / 1000));
    }

    const [rows] = await this.pool.query(query, params);

    return (rows as Record<string, any>[]).map((row) => {
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
    const quotedTable = quoteMySQLIdentifier(config.table);
    const cols = [quoteMySQLIdentifier(config.sourceId), quoteMySQLIdentifier(config.targetId)];
    if (typeof config.weight === 'string') {
      cols.push(quoteMySQLIdentifier(config.weight));
    }
    if (config.updatedAt) {
      cols.push(quoteMySQLIdentifier(config.updatedAt));
    }

    if (!this.pool) {
      await this.connect();
    }

    let query = `SELECT ${cols.join(', ')} FROM ${quotedTable}`;
    const params: any[] = [];

    if (sinceTimestamp && config.updatedAt) {
      query += ` WHERE ${quoteMySQLIdentifier(config.updatedAt)} > FROM_UNIXTIME(?)`;
      params.push(Math.floor(sinceTimestamp / 1000));
    }

    const [rows] = await this.pool.query(query, params);

    return (rows as Record<string, any>[]).map((row) => {
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
