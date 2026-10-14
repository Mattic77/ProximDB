export type SupportedDatabaseClient = 'postgres' | 'mysql' | 'mongodb' | 'memory';

export interface PostgresSourceConfig {
  client: 'postgres';
  uri?: string;
  connection?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean | object;
  };
}

export interface MySQLSourceConfig {
  client: 'mysql';
  uri?: string;
  connection?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean | object;
  };
}

export interface MongoDBSourceConfig {
  client: 'mongodb';
  uri: string;
  database?: string;
}

export interface MemorySourceConfig {
  client: 'memory';
  initialNodes?: NodeRecord[];
  initialEdges?: EdgeRecord[];
}

export type SourceConfig =
  | PostgresSourceConfig
  | MySQLSourceConfig
  | MongoDBSourceConfig
  | MemorySourceConfig;

export interface NodeMappingConfig {
  table: string;
  id?: string;
  attributes: string[];
  updatedAt?: string;
}

export interface EdgeMappingConfig {
  table: string;
  sourceId: string;
  targetId: string;
  weight?: string | number;
  updatedAt?: string;
}

export interface MappingConfig {
  nodes: Record<string, NodeMappingConfig>;
  edges?: Record<string, EdgeMappingConfig>;
}

export const DEFAULT_STORAGE_PATH = './.proximdb/search.db';

export interface ProximDBConfig {
  source: SourceConfig | DatabaseAdapter;
  embeddedStoragePath?: string;
  mapping: MappingConfig;
  syncIntervalMs?: number;
  enableTrigram?: boolean;
  verbose?: boolean;
}

export interface NodeRecord {
  id: string;
  entityType: string;
  attributes: Record<string, any>;
  searchText?: string;
  updatedAt?: number;
}

export interface EdgeRecord {
  sourceId: string;
  targetId: string;
  edgeType: string;
  weight?: number;
  updatedAt?: number;
}

export interface DatabaseAdapter {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchNodes(
    entityType: string,
    config: NodeMappingConfig,
    sinceTimestamp?: number
  ): Promise<NodeRecord[]>;
  fetchEdges(
    edgeType: string,
    config: EdgeMappingConfig,
    sinceTimestamp?: number
  ): Promise<EdgeRecord[]>;
}

export type SearchMode = 'fuzzy' | 'proximity' | 'exact' | (string & {});

export interface QueryParams {
  queryText?: string;
  forUser?: string;
  modes: SearchMode[];
  entityType?: string | string[];
  edgeTypes?: string[];
  limits?: Record<string, number>;
  threshold?: number;
  maxHops?: number;
  includeSelf?: boolean;
  filterProximityByQuery?: boolean;
}

export interface FuzzyResultItem {
  id: string;
  entityType: string;
  score: number;
  [key: string]: any;
}

export interface ProximityResultItem {
  id: string;
  entityType: string;
  mutualCount: number;
  score?: number;
  reason: string;
  mutualIds?: string[];
  [key: string]: any;
}

export interface QueryResults {
  query?: string;
  forUser?: string;
  results: {
    fuzzy?: FuzzyResultItem[];
    proximity?: ProximityResultItem[];
    [mode: string]: any[] | undefined;
  };
  meta: {
    tookMs: number;
    counts: Record<string, number>;
  };
}

export interface SyncStats {
  nodesCount: number;
  edgesCount: number;
  durationMs: number;
  timestamp: number;
}
