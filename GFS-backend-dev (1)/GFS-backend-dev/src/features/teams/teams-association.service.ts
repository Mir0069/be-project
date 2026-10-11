import type {
  IProjectRepository,
  IDomainProject,
} from '@repositories/interfaces/i-project.repository';
import type { TeamsLinkMethod } from '@db/models/teams-message.model';

export interface AssociationInput {
  contentText: string;
  channelName: string;

  channelProjectId?: string | null;
}

export interface AssociationResult {
  projectId: string | null;
  linkMethod: TeamsLinkMethod | null;
}


export class TeamsAssociationService {
  private readonly projectRepository: IProjectRepository;

  public constructor(projectRepository: IProjectRepository) {
    this.projectRepository = projectRepository;
  }

  public async resolveProject(input: AssociationInput): Promise<AssociationResult> {
    if (input.channelProjectId) {
      return { projectId: input.channelProjectId, linkMethod: 'CHANNEL_MAP' };
    }

    const haystack = `${input.contentText} ${input.channelName}`.toLowerCase();
    const projects = await this.projectRepository.listActive();
    const match = projects.find((project) => this.matches(haystack, project));

    if (match) {
      return { projectId: match.id, linkMethod: 'AUTO' };
    }

    return { projectId: null, linkMethod: null };
  }

  private matches(haystack: string, project: IDomainProject): boolean {
    const keywords = [project.projectName, project.referenceNumber, project.customerName]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map((value) => value.toLowerCase());

    return keywords.some((keyword) => haystack.includes(keyword));
  }
}
