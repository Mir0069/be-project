import { describe, expect, it } from "vitest";

import { isExtractionUpdate } from "./ProjectRouteContext";

describe("project workflow stream refresh mapping", () => {
  it("treats the user-facing stage 1 event as an AI extraction update", () => {
    expect(isExtractionUpdate(1)).toBe(true);
  });

  it("also accepts the internal stage 0 event", () => {
    expect(isExtractionUpdate(0)).toBe(true);
  });

  it("does not classify downstream workflow stages as extraction updates", () => {
    expect(isExtractionUpdate(2)).toBe(false);
    expect(isExtractionUpdate(7)).toBe(false);
  });
});
