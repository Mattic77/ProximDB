import { Database as DatabaseInstance } from 'better-sqlite3';
import { FuzzyResultItem, QueryParams } from '../types.js';
import { SearchStrategy } from './strategy.interface.js';
import { sanitizeLimit, sanitizeSearchText, sanitizeThreshold } from '../utils/security.js';

export class FuzzyStrategy implements SearchStrategy<FuzzyResultItem> {
  readonly name = 'fuzzy';

  public execute(db: DatabaseInstance, params: QueryParams): FuzzyResultItem[] {
    const query = sanitizeSearchText(params.queryText, 250).toLowerCase();
    if (!query) {
      return [];
    }

    const limit = sanitizeLimit(params.limits && params.limits.fuzzy, 10, 1000);
    const threshold = sanitizeThreshold(params.threshold, 0.65);
    const entityType = typeof params.entityType === 'string' ? params.entityType.slice(0, 100) : null;

    // Use SQL with custom fuzzy_similarity and LIKE matching
    const sql = `
      SELECT 
        id,
        entity_type as entityType,
        attributes_json as attributesJson,
        search_text as searchText,
        fuzzy_similarity(search_text, :query) as score
      FROM search_nodes
      WHERE (:entityType IS NULL OR entity_type = :entityType)
        AND (
          search_text LIKE '%' || :query || '%'
          OR fuzzy_similarity(search_text, :query) >= :threshold
        )
      ORDER BY 
        CASE 
          WHEN search_text = :query THEN 1
          WHEN search_text LIKE :query || '%' THEN 2
          WHEN search_text LIKE '%' || :query || '%' THEN 3
          ELSE 4
        END ASC,
        score DESC
      LIMIT :limit
    `;

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all({
        query,
        entityType,
        threshold,
        limit
      }) as Array<{
        id: string;
        entityType: string;
        attributesJson: string;
        searchText: string;
        score: number;
      }>;

      return rows.map((row) => {
        let attributes: Record<string, any> = {};
        try {
          attributes = JSON.parse(row.attributesJson);
        } catch {
          // ignore parsing error
        }

        return {
          id: row.id,
          entityType: row.entityType,
          ...attributes,
          score: Number(row.score.toFixed(4))
        };
      });
    } catch (err) {
      // Fallback for simple LIKE if custom function has an issue
      const fallbackSql = `
        SELECT 
          id,
          entity_type as entityType,
          attributes_json as attributesJson,
          search_text as searchText
        FROM search_nodes
        WHERE (:entityType IS NULL OR entity_type = :entityType)
          AND search_text LIKE '%' || :query || '%'
        LIMIT :limit
      `;
      const stmt = db.prepare(fallbackSql);
      const rows = stmt.all({ query, entityType, limit }) as any[];
      return rows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        ...JSON.parse(row.attributesJson),
        score: 0.8
      }));
    }
  }
}
