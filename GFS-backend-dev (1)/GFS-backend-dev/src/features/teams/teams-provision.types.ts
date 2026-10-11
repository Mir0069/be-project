// Shared shapes for the discovery -> decision -> provision flow, so the
// discovery service, the decision service and the controller agree on one
// definition instead of re-declaring near-identical ones.

/** Why a team/channel pair surfaced, for the UI and for debugging. */
export type DiscoveryReason = 'team-and-channel' | 'team-name' | 'channel-name';

export interface DiscoveredCandidate {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  score: number;
  reason: DiscoveryReason;
}

export interface IProjectTeamsDiscovery {
  findCandidates(projectName: string): Promise<DiscoveredCandidate[]>;
}

/** What the Teams tab renders. Derived at read time, never stored. */
export type ProvisionState =
  | 'DISCOVERING'
  | 'AWAITING_DECISION'
  | 'CREATING'
  | 'CONNECTED'
  | 'FAILED'
  | 'NONE';

export interface ProvisionCandidateView extends DiscoveredCandidate {
  // Non-empty means connecting needs `force` (the channel is already on
  // another project), so the UI can warn before the 409.
  linkedProjectIds: string[];
}

export interface ProvisionStateView {
  state: ProvisionState;
  candidates: ProvisionCandidateView[];
  teamName: string | null;
  channelName: string | null;
  error: string | null;
}

export interface ConnectCandidateInput {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  force?: boolean;
}
