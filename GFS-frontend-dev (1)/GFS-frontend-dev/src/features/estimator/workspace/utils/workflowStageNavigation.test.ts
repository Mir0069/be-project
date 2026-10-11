import { describe, expect, it } from "vitest";

import {
  getWorkflowStageNavigationState,
  WORKFLOW_STAGE_BY_PATH,
} from "./workflowStageNavigation";

describe("workflow stage navigation", () => {
  it("marks every data stage for arrival refresh", () => {
    expect(WORKFLOW_STAGE_BY_PATH).toEqual({
      header: 1,
      "glass-type": 2,
      "frame-type": 3,
      parameters: 4,
      addons: 5,
      proposal: 6,
      "final-parameters": 7,
    });
  });

  it("returns the refresh handoff state for a stage tab", () => {
    expect(getWorkflowStageNavigationState("frame-type")).toEqual({
      refreshWorkflowStage: 3,
    });
  });

  it("does not add a stage refresh state to non-stage tabs", () => {
    expect(getWorkflowStageNavigationState("documents")).toBeUndefined();
    expect(getWorkflowStageNavigationState("ai-insight")).toBeUndefined();
  });
});
