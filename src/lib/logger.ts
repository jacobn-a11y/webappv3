/**
 * Structured Logger
 *
 * Winston-based structured logging with JSON format for production
 * and colorized output for development. Supports request ID tracing
 * and job processing context.
 */

import winston from "winston";
import { AsyncLocalStorage } from "node:async_hooks";

// ─── Request Context ────────────────────────────────────────────────────────

export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  organizationId?: string;
  userId?: string;
}

export interface JobContext {
  jobId: string;
  callId: string;
  organizationId: string;
  accountId?: string | null;
}

const requestStore = new AsyncLocalStorage<RequestContext>();
const jobStore = new AsyncLocalStorage<JobContext>();

export { requestStore, jobStore };

// ─── Logger Setup ───────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  defaultMeta: { service: "storyengine" },
  format: winston.format.combine(
    winston.format.timestamp({ format: "ISO" }),
    winston.format.errors({ stack: true }),
    winston.format((info) => {
      // Attach request context if available
      const reqCtx = requestStore.getStore();
      if (reqCtx) {
        info.requestId = reqCtx.requestId;
        if (reqCtx.method) info.httpMethod = reqCtx.method;
        if (reqCtx.path) info.httpPath = reqCtx.path;
        if (reqCtx.organizationId) info.organizationId = reqCtx.organizationId;
        if (reqCtx.userId) info.userId = reqCtx.userId;
      }

      // Attach job context if available
      const jCtx = jobStore.getStore();
      if (jCtx) {
        info.jobId = jCtx.jobId;
        info.callId = jCtx.callId;
        info.organizationId = jCtx.organizationId;
        if (jCtx.accountId) info.accountId = jCtx.accountId;
      }

      return info;
    })(),
    isProduction
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, requestId, jobId, ...rest }) => {
            const ctx = requestId
              ? `[req:${requestId}]`
              : jobId
                ? `[job:${jobId}]`
                : "";
            const extra = Object.keys(rest).length > 0
              ? ` ${JSON.stringify(rest)}`
              : "";
            return `${timestamp} ${level} ${ctx} ${message}${extra}`;
          })
        )
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
