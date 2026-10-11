import type { IProjectRepository } from '@repositories/interfaces/i-project.repository';
import type { OutlookLinkMethod } from '@db/models/outlook-email.model';

export interface AssociationInput {
  subject: string;
  bodyText: string;
  mailboxProjectId?: string | null;
}

export interface AssociationResult {
  projectId: string | null;
  linkMethod: OutlookLinkMethod | null;
}

/**
 * Resolves the project an email belongs to. The previous heuristic subject/body
 * matcher has been removed — unmapped emails are now sent to AI for project
 * decisioning instead of being auto-linked. The only deterministic link kept is
 * the explicit per-mailbox project mapping an admin configures.
 */
export class OutlookAssociationService {
  // Retained in the signature for call-site compatibility; no longer used now
  // that heuristic matching is gone.
  public constructor(_projectRepository?: IProjectRepository) {}

  public async resolveProject(input: AssociationInput): Promise<AssociationResult> {
    if (input.mailboxProjectId) {
      return { projectId: input.mailboxProjectId, linkMethod: 'MAILBOX_MAP' };
    }

    return { projectId: null, linkMethod: null };
  }
}
