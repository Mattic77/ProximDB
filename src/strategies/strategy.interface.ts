import { Database as DatabaseInstance } from 'better-sqlite3';
import { QueryParams } from '../types.js';

export interface SearchStrategy<T = any> {
  readonly name: string;
  execute(db: DatabaseInstance, params: QueryParams): Promise<T[]> | T[];
}
