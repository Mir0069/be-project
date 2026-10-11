// Seam the project features use to get people into a project's Microsoft Teams team.
// Mirrors IProjectTeamsProvisioner: callers never depend on the Teams implementation.
export interface SyncProjectMembersRequest {
  projectId: string;
  // The user who just assigned estimators; only a Sales Manager is added for it.
  assignedBy?: string | null;
}

export interface IProjectTeamsMembership {
  // Must be non-blocking and must never throw into the caller.
  syncProject(input: SyncProjectMembersRequest): Promise<void>;
}
