import { DatabaseAdapter, EdgeMappingConfig, EdgeRecord, NodeMappingConfig, NodeRecord } from '../types.js';

export abstract class BaseAdapter implements DatabaseAdapter {
  abstract readonly name: string;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  abstract fetchNodes(
    entityType: string,
    config: NodeMappingConfig,
    sinceTimestamp?: number
  ): Promise<NodeRecord[]>;

  abstract fetchEdges(
    edgeType: string,
    config: EdgeMappingConfig,
    sinceTimestamp?: number
  ): Promise<EdgeRecord[]>;

  /**
   * Helper to build a searchable normalized text string from an object's selected attributes
   */
  protected buildSearchText(attributes: Record<string, any>): string {
    const parts: string[] = [];
    for (const val of Object.values(attributes)) {
      if (val !== null && val !== undefined) {
        if (typeof val === 'string' || typeof val === 'number') {
          parts.push(String(val).trim());
        } else if (Array.isArray(val)) {
          parts.push(val.map(String).join(' '));
        } else if (typeof val === 'object') {
          parts.push(Object.values(val).map(String).join(' '));
        }
      }
    }
    return parts.join(' ').toLowerCase();
  }
}
