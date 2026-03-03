import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listAdminPageFiles(): string[] {
  const pagesDir = join(process.cwd(), "src", "pages");
  return readdirSync(pagesDir)
    .filter(
      (name) =>
        name.startsWith("Admin") &&
        name.endsWith(".tsx") &&
        !name.endsWith(".test.tsx")
    )
    .map((name) => join(pagesDir, name));
}

describe("admin page heading contract", () => {
  const files = listAdminPageFiles();

  it("ensures each admin page includes an h1", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content.includes("<h1"), `Missing h1 in ${file}`).toBe(true);
    }
  });

  it("ensures pages with h3 sections also include h2 sections", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (content.includes("<h3")) {
        expect(content.includes("<h2"), `Has h3 without h2 in ${file}`).toBe(true);
      }
    }
  });
});
