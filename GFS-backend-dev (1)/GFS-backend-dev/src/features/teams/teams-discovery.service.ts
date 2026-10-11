import type { GraphChannel, GraphTeam } from './teams.types';
import type { DiscoveredCandidate, DiscoveryReason, IProjectTeamsDiscovery } from './teams-provision.types';
import {
  MIN_MATCH_SCORE,
  combineTeamChannelScore,
  normalizeName,
  scoreNameMatch,
  type NormalizedName,
} from './teams-discovery.util';

// Listing every team's channels is the expensive part, so the scan set is
// capped and both listings are cached for a drain pass. Small tenants (the
// realistic case) are still scanned exhaustively.
const MAX_SCAN_TEAMS = 25;
const CHANNEL_SCAN_CONCURRENCY = 5;
const DIRECTORY_TTL_MS = 300_000;
const MAX_CANDIDATES = 3;

/** The read surface discovery needs. TeamsService satisfies it structurally. */
export interface ITeamsDirectory {
  listTeams(): Promise<GraphTeam[]>;
  listChannels(teamId: string): Promise<GraphChannel[]>;
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

export class TeamsDiscoveryService implements IProjectTeamsDiscovery {
  private teamsCache: CacheEntry<GraphTeam[]> | null = null;
  private readonly channelsCache = new Map<string, CacheEntry<GraphChannel[]>>();

  public constructor(private readonly directory: ITeamsDirectory) {}

  /**
   * Ranked existing team/channel pairs that look like this project's address.
   * Returns at most MAX_CANDIDATES; a human confirms before anything is linked.
   */
  public async findCandidates(projectName: string): Promise<DiscoveredCandidate[]> {
    const target = normalizeName(projectName);
    if (target.tokens.length === 0) return [];

    const teams = await this.listTeamsCached();
    if (teams.length === 0) return [];

    const scoredTeams = teams
      .map((team) => ({ team, score: scoreNameMatch(target, normalizeName(team.displayName)) }))
      .sort((a, b) => b.score - a.score);

    const scanSet = teams.length <= MAX_SCAN_TEAMS ? scoredTeams : scoredTeams.slice(0, MAX_SCAN_TEAMS);
    const candidates: DiscoveredCandidate[] = [];

    for (let i = 0; i < scanSet.length; i += CHANNEL_SCAN_CONCURRENCY) {
      const chunk = scanSet.slice(i, i + CHANNEL_SCAN_CONCURRENCY);
      const results = await Promise.all(chunk.map((entry) => this.listChannelsCached(entry.team.id)));

      results.forEach((channels, index) => {
        const { team, score: teamScore } = chunk[index]!;
        candidates.push(...this.pairCandidates(target, team, teamScore, channels));
      });
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
  }

  private pairCandidates(
    target: NormalizedName,
    team: GraphTeam,
    teamScore: number,
    channels: GraphChannel[],
  ): DiscoveredCandidate[] {
    const paired: DiscoveredCandidate[] = [];

    for (const channel of channels) {
      // The channel must match on its own merit. Gating on the combined score
      // would let a strong team score drag in every channel it owns.
      const channelScore = scoreNameMatch(target, normalizeName(channel.displayName));
      if (channelScore < MIN_MATCH_SCORE) continue;

      const score = combineTeamChannelScore(teamScore, channelScore);
      paired.push({
        teamId: team.id,
        teamName: team.displayName,
        channelId: channel.id,
        channelName: channel.displayName,
        score,
        reason: TeamsDiscoveryService.reasonFor(teamScore, channelScore),
      });
    }

    // A matching team whose channels are all generically named still deserves
    // an entry, so the human can pick its first channel.
    if (paired.length === 0 && teamScore >= MIN_MATCH_SCORE && channels.length > 0) {
      const channel = channels[0]!;
      paired.push({
        teamId: team.id,
        teamName: team.displayName,
        channelId: channel.id,
        channelName: channel.displayName,
        score: combineTeamChannelScore(teamScore, 0),
        reason: 'team-name',
      });
    }

    return paired;
  }

  private static reasonFor(teamScore: number, channelScore: number): DiscoveryReason {
    if (teamScore >= MIN_MATCH_SCORE && channelScore >= MIN_MATCH_SCORE) return 'team-and-channel';
    return teamScore >= MIN_MATCH_SCORE ? 'team-name' : 'channel-name';
  }

  private async listTeamsCached(): Promise<GraphTeam[]> {
    if (this.teamsCache && Date.now() - this.teamsCache.at < DIRECTORY_TTL_MS) {
      return this.teamsCache.value;
    }
    const value = await this.directory.listTeams();
    this.teamsCache = { at: Date.now(), value };
    return value;
  }

  // A team we cannot read (403 on a team the app isn't allowed into) must not
  // fail the whole discovery, so failures resolve to an empty channel list.
  private async listChannelsCached(teamId: string): Promise<GraphChannel[]> {
    const cached = this.channelsCache.get(teamId);
    if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.value;

    try {
      const value = await this.directory.listChannels(teamId);
      this.channelsCache.set(teamId, { at: Date.now(), value });
      return value;
    } catch (err) {
      console.warn(`[TeamsDiscovery] skipping team ${teamId}:`, err instanceof Error ? err.message : err);
      return [];
    }
  }
}
