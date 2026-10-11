import { describe, it, expect } from "vitest";

import { getDocumentSource, getDocumentSourceKey } from "./documentSource";

describe("documentSource", () => {
  it("maps teams / outlook / dropbox / manual to display labels", () => {
    expect(getDocumentSource({ metadata: { source: "dropbox" } }).label).toBe("Dropbox");
    expect(getDocumentSource({ uploadedBy: "dropbox" }).label).toBe("Dropbox");
    expect(getDocumentSource({ metadata: { source: "teams" } }).label).toBe("Teams");
    expect(getDocumentSource({ metadata: { source: "outlook" } }).label).toBe("Mail");
    expect(getDocumentSource({ metadata: { source: "cloud-link", emailId: "some-email" } }).label).toBe("Mail");
    expect(getDocumentSource({ metadata: { source: "cloud-link", teamsMessageId: "some-teams" } }).label).toBe("Teams");
    expect(getDocumentSource({ metadata: {} }).label).toBe("Manual");
    expect(getDocumentSource(null).label).toBe("Manual");
    expect(getDocumentSource(undefined).label).toBe("Manual");
  });

  it("is case-insensitive and defaults unknown sources to manual", () => {
    expect(getDocumentSourceKey({ metadata: { source: "DROPBOX" } })).toBe("dropbox");
    expect(getDocumentSourceKey({ uploadedBy: "DROPBOX" })).toBe("dropbox");
    expect(getDocumentSourceKey({ metadata: { source: "TEAMS" } })).toBe("teams");
    expect(getDocumentSourceKey({ metadata: { source: "Outlook" } })).toBe("outlook");
    expect(getDocumentSourceKey({ metadata: { source: "cloud-link", emailId: "123" } })).toBe("outlook");
    expect(getDocumentSourceKey({ metadata: { source: "cloud-link", teamsMessageId: "123" } })).toBe("teams");
    expect(getDocumentSourceKey({ metadata: { source: "slack" } })).toBe("manual");
  });
});
