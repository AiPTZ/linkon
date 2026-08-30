import type { NextFunction, Request, Response } from "express";
import { getClientIp } from "../utils/clientIp";

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_ENTRIES = 10_000;

const registry = new Set<Map<string, Bucket>>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  key?: (req: Request) => string;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max } = options;
  const keyOf = options.key ?? getClientIp;
  const buckets = new Map<string, Bucket>();
  registry.add(buckets);

  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size > MAX_ENTRIES) {
      const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)[0];
      if (oldest) buckets.delete(oldest[0]);
    }
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    sweep(now);

    const key = keyOf(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "Muitas tentativas. Aguarde alguns segundos e tente novamente." });
      return;
    }

    next();
  };
}

export function _clearRateLimitBucketsForTests(): void {
  for (const buckets of registry) buckets.clear();
}
