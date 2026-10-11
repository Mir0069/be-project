/**
 * Maps workspace tabs to the proposal stage whose data may arrive shortly
 * after the previous stage is approved.
 */
export const WORKFLOW_STAGE_BY_PATH: Readonly<Record<string, number>> = {
  header: 1,
  "glass-type": 2,
  "frame-type": 3,
  parameters: 4,
  addons: 5,
  proposal: 6,
  "final-parameters": 7,
};

export const getWorkflowStageNavigationState = (path: string) => {
  const stage = WORKFLOW_STAGE_BY_PATH[path];

  return stage === undefined
    ? undefined
    : { refreshWorkflowStage: stage };
};
