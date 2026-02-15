/**
 * OpenTelemetry Instrumentation
 *
 * Sets up automatic tracing for Express HTTP requests and Prisma database
 * queries. Exports traces via OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT
 * is configured.
 *
 * IMPORTANT: This file must be loaded before any other imports via
 * --require or by importing at the very top of the entry point.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import logger from "./logger.js";

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "storyengine",
  [ATTR_SERVICE_VERSION]: "0.1.0",
  "deployment.environment": process.env.NODE_ENV ?? "development",
});

const instrumentations = [
  new HttpInstrumentation(),
  new ExpressInstrumentation(),
  new PrismaInstrumentation(),
];

let sdk: NodeSDK | null = null;

export function initOtel(): void {
  const traceExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : undefined;

  const metricReader = otlpEndpoint
    ? new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${otlpEndpoint}/v1/metrics`,
        }),
        exportIntervalMillis: 30_000,
      })
    : undefined;

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations,
  });

  sdk.start();
  logger.info("OpenTelemetry instrumentation initialized", {
    otlpEndpoint: otlpEndpoint ?? "none (console only)",
    instrumentations: ["http", "express", "prisma"],
  });
}

export async function shutdownOtel(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    logger.info("OpenTelemetry shut down");
  }
}
