import { describe, expect, it } from "vitest";

import {
  getDocumentDisplayLabel,
  getVisibleProjectDocuments,
  isInternalEmailDocumentName,
} from "./documentLabel";

describe("getDocumentDisplayLabel", () => {
  it("replaces generated mail identifiers with a readable label", () => {
    expect(
      getDocumentDisplayLabel(
        "email-AAMkADNkZTc5YzViLTcwOGQtNDFhMy1hYmMzLWVjMTNmZjg2MjQ0",
      ),
    ).toBe("Attachment");
  });

  it("keeps readable filenames returned by the backend", () => {
    expect(getDocumentDisplayLabel("Ernesto Caceres.pdf")).toBe(
      "Ernesto Caceres.pdf",
    );
  });

  it("uses the filename when the backend returns a path", () => {
    expect(
      getDocumentDisplayLabel("projects/reference/drawings/floor-plan.pdf?token=private"),
    ).toBe("floor-plan.pdf");
  });

  it("uses the fallback for an empty value", () => {
    expect(getDocumentDisplayLabel(null)).toBe("Attachment");
  });

  it("identifies generated email body notes without hiding normal text files", () => {
    expect(isInternalEmailDocumentName("email-AAMk123.txt")).toBe(true);
    expect(isInternalEmailDocumentName("Email Body Text")).toBe(true);
    expect(isInternalEmailDocumentName("site-notes.txt")).toBe(false);
  });

  it("keeps only active, unique, human-visible project documents", () => {
    const visible = getVisibleProjectDocuments([
      { id: "body", originalName: "email-AAMk123.txt" },
      { id: "deleted", originalName: "old-plan.pdf", isDeleted: true },
      { id: "plan", originalName: "plans/floor-plan.pdf" },
      { id: "duplicate", originalName: "floor-plan.pdf" },
    ]);

    expect(visible.map((document) => document.originalName)).toEqual(["plans/floor-plan.pdf"]);
  });
});
