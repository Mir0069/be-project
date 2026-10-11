// Naming rules for auto-provisioned Teams workspaces.
//   Team    : "GFS - {projectName}"        (Graph displayName limit 256)
//   Channel : "{projectName} discussion"   (Graph channel displayName limit 50)
// The channel name is truncated so the whole string (incl. the suffix) fits 50.

const TEAM_NAME_MAX = 256;
const CHANNEL_NAME_MAX = 50;
const CHANNEL_SUFFIX = ' discussion';
const FALLBACK_NAME = 'Untitled Project';

export interface TeamsNames {
  teamName: string;
  channelName: string;
}

export const buildTeamsNames = (projectName: string): TeamsNames => {
  const name = (projectName ?? '').trim() || FALLBACK_NAME;

  const teamName = `GFS - ${name}`.slice(0, TEAM_NAME_MAX);

  // Reserve room for the suffix; trim trailing space left by the cut.
  const maxBase = CHANNEL_NAME_MAX - CHANNEL_SUFFIX.length;
  const base = name.length > maxBase ? name.slice(0, maxBase).trimEnd() : name;
  const channelName = `${base}${CHANNEL_SUFFIX}`.slice(0, CHANNEL_NAME_MAX);

  return { teamName, channelName };
};

// The name a job should use at the moment it creates the team, which can be
// long after enqueue. projectName is the creation-time value the UI shows;
// jobAddress is the fallback when a project somehow has no name.
export const resolveProjectDisplayName = (project: {
  projectName: string;
  jobAddress: string | null;
}): string => project.projectName.trim() || (project.jobAddress ?? '').trim() || FALLBACK_NAME;
