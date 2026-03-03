import { describe, it, expect } from "vitest";
import { collectLinkCandidates, validateLinkSyntax } from "./publish-link-utils.js";

describe("publish-link-utils", () => {
  it("collects markdown and bare links with field attribution", () => {
    const links = collectLinkCandidates([
      { field: "editable_body", text: "Read [docs](https://example.com/docs) and https://foo.test/path." },
      { field: "callout_boxes.0.body", text: "<mailto:ops@example.com>" },
    ]);

    expect(links).toEqual(
      expect.arrayContaining([
        { field: "editable_body", url: "https://example.com/docs" },
        { field: "editable_body", url: "https://foo.test/path" },
        { field: "callout_boxes.0.body", url: "mailto:ops@example.com" },
      ])
    );
  });

  it("flags unsafe/malformed links", () => {
    const issues = validateLinkSyntax([
      { field: "editable_body", url: "javascript:alert(1)" },
      { field: "editable_body", url: "ftp://example.com/file" },
      { field: "editable_body", url: "www.example.com/no-protocol" },
      { field: "editable_body", url: "https://valid.example/path" },
      { field: "editable_body", url: "/relative/path" },
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsafe_link_scheme" }),
        expect.objectContaining({ code: "unsupported_link_scheme" }),
        expect.objectContaining({ code: "malformed_link_url" }),
      ])
    );
    expect(
      issues.find((issue) => issue.url === "https://valid.example/path")
    ).toBeUndefined();
    expect(issues.find((issue) => issue.url === "/relative/path")).toBeUndefined();
  });
});
