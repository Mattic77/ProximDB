import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ProximDB } from '../index.js';
import type { QueryParams, QueryResults } from '../types.js';
import { sanitizeLimit, sanitizeSearchText, sanitizeUserId } from '../utils/security.js';

export interface ExpressMiddlewareOptions {
  property?: string; // Property name on Request object, default: 'proxim'
}

export interface SearchHandlerOptions {
  extractUser?: (req: Request) => string | undefined;
  extractQuery?: (req: Request) => string | undefined;
  defaultModes?: Array<'fuzzy' | 'proximity' | string>;
  defaultLimits?: Record<string, number>;
}

declare global {
  namespace Express {
    interface Request {
      proxim?: ProximDB;
    }
  }
}

/**
 * Express middleware that attaches the ProximDB instance to the Request object (`req.proxim`)
 */
export function proximMiddleware(engine: ProximDB, options?: ExpressMiddlewareOptions): RequestHandler {
  const prop = options?.property || 'proxim';
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any)[prop] = engine;
    next();
  };
}

/**
 * Ready-to-use Express route handler for multi-mode search
 *
 * Example:
 *   app.get('/api/search', createSearchHandler(engine));
 */
export function createSearchHandler(engine: ProximDB, options?: SearchHandlerOptions): RequestHandler {
  const SAFE_MODE_REGEX = /^[a-zA-Z0-9_-]{1,50}$/;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawQuery = options?.extractQuery
        ? options.extractQuery(req)
        : req.query.q ?? req.query.query;
      const queryText = sanitizeSearchText(rawQuery, 250);

      const rawUser = options?.extractUser
        ? options.extractUser(req)
        : (req as any).user?.id ?? req.query.forUser ?? req.query.userId;
      const forUser = sanitizeUserId(rawUser, 250) || undefined;

      let modesInput: any[] = options?.defaultModes || ['fuzzy', 'proximity'];
      if (typeof req.query.modes === 'string') {
        modesInput = req.query.modes.split(',').map((m) => m.trim());
      } else if (Array.isArray(req.query.modes)) {
        modesInput = req.query.modes;
      }
      // Strict whitelist check on mode names to avoid unexpected strategy resolution
      const modes = modesInput
        .filter((m): m is string => typeof m === 'string' && SAFE_MODE_REGEX.test(m))
        .slice(0, 10);

      const defaultLimits = options?.defaultLimits || { fuzzy: 10, proximity: 5 };
      const limits: Record<string, number> = {
        fuzzy: sanitizeLimit(defaultLimits.fuzzy, 10, 1000),
        proximity: sanitizeLimit(defaultLimits.proximity, 5, 1000)
      };

      if (req.query.limit) {
        const parsedLimit = sanitizeLimit(req.query.limit, 10, 1000);
        limits.fuzzy = parsedLimit;
        limits.proximity = parsedLimit;
      }

      const rawEntityType = typeof req.query.entityType === 'string' ? req.query.entityType.trim() : undefined;
      const entityType = rawEntityType && /^[a-zA-Z0-9_]{1,100}$/.test(rawEntityType) ? rawEntityType : undefined;

      const queryParams: QueryParams = {
        queryText,
        forUser,
        modes,
        entityType,
        limits
      };

      const results: QueryResults = await engine.query(queryParams);
      res.json(results);
    } catch (err) {
      next(err);
    }
  };
}
