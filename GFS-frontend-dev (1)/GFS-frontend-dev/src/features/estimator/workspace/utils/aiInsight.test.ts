import { describe, expect, it } from "vitest";

import {
  buildStageExtractionSummary,
  getStageExtractionReasoning,
  getZohoNoteSummary,
  isEmptyAttachmentValue,
  isTranscriptNoise,
} from "./aiInsight";

describe("AI Insight display helpers", () => {
  it("recognizes empty attachment values without treating real names as empty", () => {
    expect(isEmptyAttachmentValue("[]")).toBe(true);
    expect(isEmptyAttachmentValue("[ ]")).toBe(true);
    expect(isEmptyAttachmentValue("['']")).toBe(true);
    expect(isEmptyAttachmentValue('[""]')).toBe(true);
    expect(isEmptyAttachmentValue("No attachments.")).toBe(true);
    expect(isEmptyAttachmentValue("proposal.pdf")).toBe(false);
  });

  it("builds an AI Insight fallback from re-triggered stage results", () => {
    expect(
      buildStageExtractionSummary({
        project_name: { value: "Robinson Residence" },
        project_type: { value: "RESIDENTIAL" },
        reasoning: "Re-triggered from the latest project email.",
        _signals: { is_exterior: true },
      }),
    ).toBe("Project Name: Robinson Residence\nProject Type: RESIDENTIAL");
  });

  it("leaves staff assignments out of the AI Insight summary and reasoning", () => {
    const fields = {
      project_name: { value: "Harbor Point Retail Center" },
      person_quoting: { value: "Anudeep Edulakanti", reasoning: "Assigned estimator." },
      person_checked: { value: "Greg Muniz" },
    };

    expect(buildStageExtractionSummary(fields)).toBe("Project Name: Harbor Point Retail Center");
    expect(getStageExtractionReasoning(fields)).toEqual([]);
  });

  it("keeps the Zoho note summary out of the summary and field reasoning, and returns it on its own", () => {
    const fields = {
      project_name: { value: "Riverside Commons", reasoning: "Matched the subject." },
      crm_note_summary: { value: " One interior glass floor, Series 1000 perimeter frame. ", reasoning: ["One interior glass floor."] },
    };

    expect(buildStageExtractionSummary(fields)).toBe("Project Name: Riverside Commons");
    expect(getStageExtractionReasoning(fields)).toEqual(["Matched the subject."]);
    expect(getZohoNoteSummary(fields)).toBe("One interior glass floor, Series 1000 perimeter frame.");
    expect(getZohoNoteSummary({ project_name: { value: "x" } })).toBe("");
    expect(getZohoNoteSummary(null)).toBe("");
  });

  it("recognizes meeting-transcript markup", () => {
    expect(isTranscriptNoise("00:00:08.000 --> 00:00:16.000.")).toBe(true);
    expect(isTranscriptNoise("WEBVTT")).toBe(true);
    expect(isTranscriptNoise("00:00:16...[truncated].")).toBe(true);
    expect(isTranscriptNoise("This is one unit only.")).toBe(false);
    expect(isTranscriptNoise("Frame depth is 5 inches at 10:30 site visit.")).toBe(false);
  });

  it("collects stage and field reasoning for re-triggered results", () => {
    expect(
      getStageExtractionReasoning({
        reasoning: "Latest email was included in the extraction.",
        project_name: { value: "Robinson Residence", reasoning: "Matched the subject." },
      }),
    ).toEqual(["Latest email was included in the extraction.", "Matched the subject."]);
  });

});
