import { describe, expect, it } from "vitest";

import type { ZohoNote } from "@/shared/types/zoho.types";

import { findApprovalNote, getZohoApprovalHeading } from "./approvalNote";

const note = (id: string, content: string): ZohoNote => ({
  id,
  title: null,
  content,
  author: "Jamunesh Sheta",
  createdTime: "2026-09-28T07:04:00Z",
});

const transcript = `WEBVTT\n\n0a6f877a/5-0\n00:00:12.394 --> 00:00:13.274\nHow's it going, Dan?\n\n${"More of the call. ".repeat(40)}`;
const notes = [note("n-1", "Short note about glass."), note("n-2", transcript)];

describe("findApprovalNote", () => {
  it("finds the note whose start the approval quotes", () => {
    const reasoning = `Zoho was updated. Latest note by Jamunesh Sheta: "${transcript.slice(0, 300)}...[truncated]"`;

    expect(findApprovalNote(reasoning, notes)?.id).toBe("n-2");
  });

  it("matches even after the reasoning's whitespace was collapsed", () => {
    const reasoning = `Zoho was updated. Description: "No IGU" Latest note by Jamunesh Sheta: "${transcript.slice(0, 300).replace(/\s+/g, " ")}...[truncated]"`;

    expect(findApprovalNote(reasoning, notes)?.id).toBe("n-2");
  });

  it("finds a short note quoted in full", () => {
    expect(findApprovalNote('Zoho was updated. Latest note by Jamunesh Sheta: "Short note about glass."', notes)?.id).toBe("n-1");
  });

  it("names the approval text by what Zoho sent", () => {
    expect(getZohoApprovalHeading('Zoho was updated. Latest note by Jamunesh Sheta: "jemmu"')).toBe("Zoho note");
    expect(getZohoApprovalHeading('Zoho was updated. Description: "No IGU, Series 2000"')).toBe("Zoho description");
    expect(getZohoApprovalHeading('Zoho was updated. Description: "No IGU" Latest note by Ann: "Series 2000"')).toBe(
      "Zoho description and note",
    );
    expect(getZohoApprovalHeading('Zoho was updated. Latest note by Ann: "Description: \\"x\\""')).toBe("Zoho note");
  });

  it("returns null when the approval quotes no note or nothing matches", () => {
    expect(findApprovalNote('Zoho was updated. Description: "Series 2000"', notes)).toBeNull();
    expect(findApprovalNote('Zoho was updated. Latest note by X: "Something else"', notes)).toBeNull();
    expect(findApprovalNote(undefined, notes)).toBeNull();
  });
});
