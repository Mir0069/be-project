/**
 * quote-numbering.service.ts
 *
 * Wraps the pure numbering logic (quote-number.engine.ts) with persistence, using ONLY
 * the existing IProjectRepository contract (findById + updateById) — no new
 * repository methods required.
 */

import type { IProjectRepository} from '@repositories/interfaces/i-project.repository';
import {
  generateNextQuoteNumber,
} from './quote-number.engine';

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class QuoteNumberingService {
  constructor(private readonly projectRepository: IProjectRepository) {}

  /**
   * Computes and persists the next quote number for a project, per the GFS
   * Quotation Numbering Convention:
   *   - no quoteNumber yet      -> base only, e.g. "20261012"
   *   - quoteNumber = base      -> base + "A"
   *   - quoteNumber = base + X  -> base + next(X)
   *
   * Call this at the point a quote is actually issued/re-issued to the client
   * (e.g. right before the Excel/Proposal sheet is generated and sent), NOT
   * at project-creation time — quoteNumber should stay null until the first
   * quote actually goes out.
   */
  async issueNextQuoteNumber(projectId: string): Promise<string> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }

    const nextQuoteNumber = generateNextQuoteNumber({
      referenceNumber: project.referenceNumber,
      quoteNumber: project.quoteNumber,
    });

    const updated = await this.projectRepository.updateById(projectId, {
      quoteNumber: nextQuoteNumber,
    });

    if (!updated) {
      // updateById returning null here means the project vanished between the
      // findById above and this update — treat as not-found rather than silently
      // swallowing it.
      throw new ProjectNotFoundError(projectId);
    }

    return nextQuoteNumber;
  }

  /**
   * Read-only preview of what the next quote number WOULD be, without persisting.
   * Useful for UI ("this will be quote #20261012A") before the user confirms.
   */
  async previewNextQuoteNumber(projectId: string): Promise<string> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }

    return generateNextQuoteNumber({
      referenceNumber: project.referenceNumber,
      quoteNumber: project.quoteNumber,
    });
  }
}