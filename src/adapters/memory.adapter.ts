import { BaseAdapter } from './base.adapter.js';
import { EdgeMappingConfig, EdgeRecord, MemorySourceConfig, NodeMappingConfig, NodeRecord } from '../types.js';

export class MemoryAdapter extends BaseAdapter {
  readonly name = 'MemoryAdapter';
  private nodes: NodeRecord[] = [];
  private edges: EdgeRecord[] = [];

  constructor(config?: MemorySourceConfig) {
    super();
    if (config?.initialNodes) {
      this.setNodes(config.initialNodes);
    }
    if (config?.initialEdges) {
      this.setEdges(config.initialEdges);
    }
  }

  public async connect(): Promise<void> {
    // In-memory noop
  }

  public async disconnect(): Promise<void> {
    // In-memory noop
  }

  public addNode(node: NodeRecord): void {
    if (!node.searchText) {
      node.searchText = this.buildSearchText(node.attributes);
    }
    if (!node.updatedAt) {
      node.updatedAt = Date.now();
    }
    const idx = this.nodes.findIndex((n) => n.id === node.id && n.entityType === node.entityType);
    if (idx >= 0) {
      this.nodes[idx] = node;
    } else {
      this.nodes.push(node);
    }
  }

  public addEdge(edge: EdgeRecord): void {
    if (!edge.updatedAt) {
      edge.updatedAt = Date.now();
    }
    if (edge.weight === undefined) {
      edge.weight = 1.0;
    }
    const idx = this.edges.findIndex(
      (e) => e.sourceId === edge.sourceId && e.targetId === edge.targetId && e.edgeType === edge.edgeType
    );
    if (idx >= 0) {
      this.edges[idx] = edge;
    } else {
      this.edges.push(edge);
    }
  }

  public setNodes(nodes: NodeRecord[]): void {
    this.nodes = nodes.map((n) => ({
      ...n,
      searchText: n.searchText || this.buildSearchText(n.attributes),
      updatedAt: n.updatedAt || Date.now()
    }));
  }

  public setEdges(edges: EdgeRecord[]): void {
    this.edges = edges.map((e) => ({
      ...e,
      weight: e.weight !== undefined ? e.weight : 1.0,
      updatedAt: e.updatedAt || Date.now()
    }));
  }

  public async fetchNodes(
    entityType: string,
    _config: NodeMappingConfig,
    sinceTimestamp?: number
  ): Promise<NodeRecord[]> {
    return this.nodes.filter((n) => {
      if (n.entityType !== entityType) return false;
      if (sinceTimestamp && n.updatedAt && n.updatedAt <= sinceTimestamp) return false;
      return true;
    });
  }

  public async fetchEdges(
    edgeType: string,
    _config: EdgeMappingConfig,
    sinceTimestamp?: number
  ): Promise<EdgeRecord[]> {
    return this.edges.filter((e) => {
      if (e.edgeType !== edgeType) return false;
      if (sinceTimestamp && e.updatedAt && e.updatedAt <= sinceTimestamp) return false;
      return true;
    });
  }
}
