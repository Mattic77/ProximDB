import { BaseAdapter } from './base.adapter.js';
import { EdgeMappingConfig, EdgeRecord, MongoDBSourceConfig, NodeMappingConfig, NodeRecord } from '../types.js';
import { validateIdentifier } from '../utils/security.js';

export class MongoDBAdapter extends BaseAdapter {
  readonly name = 'MongoDBAdapter';
  private config: MongoDBSourceConfig;
  private client: any = null;
  private db: any = null;

  constructor(config: MongoDBSourceConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    if (this.client) return;

    let mongo: any;
    try {
      mongo = await import('mongodb');
    } catch {
      throw new Error(
        'The "mongodb" package is required to use MongoDBAdapter. Please install it with: npm install mongodb'
      );
    }

    const { MongoClient } = mongo;
    this.client = new MongoClient(this.config.uri);
    await this.client.connect();
    this.db = this.client.db(this.config.database);
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  public async fetchNodes(
    entityType: string,
    config: NodeMappingConfig,
    sinceTimestamp?: number
  ): Promise<NodeRecord[]> {
    const safeTable = validateIdentifier(config.table);
    const idCol = config.id ? validateIdentifier(config.id) : '_id';
    const attributes = config.attributes.map((attr) => validateIdentifier(attr));

    if (!this.db) {
      await this.connect();
    }

    const collection = this.db.collection(safeTable);

    const projection: Record<string, number> = { [idCol]: 1 };
    for (const attr of attributes) {
      projection[attr] = 1;
    }
    if (config.updatedAt) {
      const safeUpdatedAt = validateIdentifier(config.updatedAt);
      projection[safeUpdatedAt] = 1;
    }

    const filter: Record<string, any> = {};
    if (typeof sinceTimestamp === 'number' && !isNaN(sinceTimestamp) && config.updatedAt) {
      const safeUpdatedAt = validateIdentifier(config.updatedAt);
      filter[safeUpdatedAt] = {
        $gt: new Date(sinceTimestamp)
      };
    }

    const docs = await collection.find(filter, { projection }).toArray();

    return docs.map((doc: Record<string, any>) => {
      const id = String(doc[idCol]);
      const attrs: Record<string, any> = {};
      for (const attr of attributes) {
        attrs[attr] = doc[attr];
      }
      const updatedAt = config.updatedAt && doc[config.updatedAt]
        ? new Date(doc[config.updatedAt]).getTime()
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
    const safeTable = validateIdentifier(config.table);
    const sourceCol = validateIdentifier(config.sourceId);
    const targetCol = validateIdentifier(config.targetId);

    if (!this.db) {
      await this.connect();
    }

    const collection = this.db.collection(safeTable);

    const projection: Record<string, number> = {
      [sourceCol]: 1,
      [targetCol]: 1
    };
    if (typeof config.weight === 'string') {
      projection[validateIdentifier(config.weight)] = 1;
    }
    if (config.updatedAt) {
      projection[validateIdentifier(config.updatedAt)] = 1;
    }

    const filter: Record<string, any> = {};
    if (typeof sinceTimestamp === 'number' && !isNaN(sinceTimestamp) && config.updatedAt) {
      const safeUpdatedAt = validateIdentifier(config.updatedAt);
      filter[safeUpdatedAt] = {
        $gt: new Date(sinceTimestamp)
      };
    }

    const docs = await collection.find(filter, { projection }).toArray();

    return docs.map((doc: Record<string, any>) => {
      let weight = 1.0;
      if (typeof config.weight === 'number') {
        weight = config.weight;
      } else if (typeof config.weight === 'string' && doc[config.weight] !== undefined) {
        weight = Number(doc[config.weight]) || 1.0;
      }

      const updatedAt = config.updatedAt && doc[config.updatedAt]
        ? new Date(doc[config.updatedAt]).getTime()
        : Date.now();

      return {
        sourceId: String(doc[config.sourceId]),
        targetId: String(doc[config.targetId]),
        edgeType,
        weight,
        updatedAt
      };
    });
  }
}
