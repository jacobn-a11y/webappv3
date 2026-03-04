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
      await page.setContent(msg.html, { waitUntil: "networkidle0" });

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
