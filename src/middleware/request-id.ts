import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

/**
 * Middleware that generates a unique request ID and stores it in res.locals
 * The requestId can be used downstream for request-scoped operations
 *
 * Access in handlers via: res.locals.requestId (typed as string)
 */
export const requestIdMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  res.locals.requestId = randomUUID();
  next();
};
