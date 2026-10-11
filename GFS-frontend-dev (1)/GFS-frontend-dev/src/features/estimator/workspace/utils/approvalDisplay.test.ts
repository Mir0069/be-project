import { describe, it, expect } from "vitest";

import type { ApiDocument } from "@/services/documents";
import type { PendingApproval } from "@/services/proposals";
import type { OutlookEmail } from "@/shared/types/email.types";

import { findApprovalEmail, resolveApprovalDocuments } from "./approvalDisplay";

const EMAIL_NOTE_NAME =
  "email-AAMkADNkZTc5YzViLTcwOGQtNDFhMy1hYmMzLWVjMTNmMjg=.txt";

const doc = (id: string, originalName: string) =>
  ({ id, originalName }) as Pick<ApiDocument, "id" | "originalName">;

const approval = (
  documentIds: string[],
  documentNames: string[],
): Pick<PendingApproval, "documentIds" | "documentNames"> => ({
  documentIds,
  documentNames,
});

const email = (fields: Partial<OutlookEmail>) => fields as OutlookEmail;

describe("resolveApprovalDocuments", () => {
  it("drops the internal email body file", () => {
    const result = resolveApprovalDocuments(
      approval(["d1"], [EMAIL_NOTE_NAME]),
      [doc("d1", EMAIL_NOTE_NAME)],
    );

    expect(result).toEqual([]);
  });

  it("returns the live document name, not the snapshot stored on the approval", () => {
    const result = resolveApprovalDocuments(
      approval(["d1"], ["stale.pdf"]),
      [doc("d1", "Ernesto Caceres .pdf")],
    );

    expect(result).toEqual([{ id: "d1", name: "Ernesto Caceres .pdf" }]);
  });

  it("does not pair ids with names by index", () => {
    // The backend builds documentNames from a $in query, so its order is unrelated
    // to the id order. Each id must keep its own name.
    const result = resolveApprovalDocuments(
      approval(["d1", "d2"], ["Floorplan and elevations[92].pdf", "Ernesto Caceres .pdf"]),
      [doc("d2", "Floorplan and elevations[92].pdf"), doc("d1", "Ernesto Caceres .pdf")],
    );

    expect(result).toEqual([
      { id: "d1", name: "Ernesto Caceres .pdf" },
      { id: "d2", name: "Floorplan and elevations[92].pdf" },
    ]);
  });

  it("falls back to the approval names when the documents are not loaded", () => {
    const result = resolveApprovalDocuments(
      approval(["d1", "d2"], ["Floorplan and elevations[92].pdf", EMAIL_NOTE_NAME]),
      [],
    );

    expect(result).toEqual([{ name: "Floorplan and elevations[92].pdf" }]);
    expect(result[0].id).toBeUndefined();
  });

  it("drops the backend placeholder names", () => {
    expect(resolveApprovalDocuments(approval([], ["Email Body Text"]), [])).toEqual([]);
    expect(resolveApprovalDocuments(approval([], ["Email attachment"]), [])).toEqual([]);
  });
});

describe("findApprovalEmail", () => {
  const target = email({ id: "e1", internetMessageId: "<msg-1>", subject: "dimension changes" });
  const other = email({ id: "e2", internetMessageId: "<msg-2>", subject: "dimension changes" });

  it("matches on sourceId even when another email shares the subject", () => {
    const found = findApprovalEmail({ sourceId: "e1", messageId: undefined }, [other, target]);
    expect(found?.id).toBe("e1");
  });

  it("falls back to internetMessageId when no id matches", () => {
    const found = findApprovalEmail({ sourceId: "gone", messageId: "<msg-2>" }, [other, target]);
    expect(found?.id).toBe("e2");
  });

  it("returns undefined when neither identifier matches", () => {
    const found = findApprovalEmail({ sourceId: "gone", messageId: "<msg-9>" }, [other, target]);
    expect(found).toBeUndefined();
  });
});
