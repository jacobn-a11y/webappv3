/**
 * PDF Export Worker (worker_threads)
 *
 * Runs Puppeteer in a dedicated thread so that PDF generation does not block
 * the main event loop.  The parent thread sends a message with the HTML
 * string and PDF options; this worker launches a headless browser, renders
 * the page, generates the PDF, and posts the resulting buffer back.
 *
 * Message protocol
 * ────────────────
 *   Parent  -> Worker : { html: string; pdfOptions: PuppeteerPdfOptions }
 *   Worker  -> Parent : { buffer: Uint8Array }          (on success)
 *   Worker  -> Parent : { error: string }               (on failure)
 */

import { parentPort } from "node:worker_threads";
import puppeteer from "puppeteer-core";
import type { HTTPRequest } from "puppeteer-core";
import { assertSafeOutboundUrl, parseHostAllowlist } from "../lib/url-security.js";

if (!parentPort) {
  throw new Error("pdf-export-worker must be run as a worker_threads Worker");
}

export interface PdfWorkerRequest {
  html: string;
  pdfOptions: {
    format: string;
    printBackground: boolean;
    margin: { top: string; bottom: string; left: string; right: string };
    displayHeaderFooter: boolean;
    headerTemplate: string;
    footerTemplate: string;
  };
}

const PDF_SET_CONTENT_TIMEOUT_MS = resolvePositiveInt(
  process.env.PDF_SET_CONTENT_TIMEOUT_MS,
  20_000
);
const PDF_ASSET_ALLOWLIST = parseHostAllowlist(process.env.PDF_EXPORT_ASSET_HOST_ALLOWLIST);

parentPort.on("message", async (msg: PdfWorkerRequest) => {
  try {
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser";

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    });

    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        void enforceRequestPolicy(request);
      });

      await page.setContent(msg.html, {
        waitUntil: "networkidle0",
        timeout: PDF_SET_CONTENT_TIMEOUT_MS,
      });

      const pdfBuffer = await page.pdf(msg.pdfOptions as Parameters<typeof page.pdf>[0]);

      // Post the buffer back.  Transfer the underlying ArrayBuffer so there
      // is no copying overhead.
      const uint8 = new Uint8Array(pdfBuffer);
      parentPort!.postMessage({ buffer: uint8 }, [uint8.buffer]);
    } finally {
      await browser.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ error: message });
  }
});

async function enforceRequestPolicy(request: HTTPRequest): Promise<void> {
  try {
    const url = request.url();
    if (
      url === "about:blank" ||
      url.startsWith("data:") ||
      url.startsWith("blob:")
    ) {
      await request.continue();
      return;
    }

    await assertSafeOutboundUrl(url, {
      allowHttp: process.env.NODE_ENV !== "production",
      allowHttps: true,
      denyPrivateNetworks: true,
      allowlistHosts: PDF_ASSET_ALLOWLIST,
    });
    await request.continue();
  } catch {
    try {
      await request.abort("blockedbyclient");
    } catch {
      // Request may already be resolved; ignore.
    }
  }
}

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
