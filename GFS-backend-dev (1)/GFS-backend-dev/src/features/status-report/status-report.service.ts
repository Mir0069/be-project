import type { IDomainProject, IProjectRepository } from '@repositories/interfaces/i-project.repository';
import { ProjectStatus } from '@db/models/project.model';
import type { StatusReportData, StatusReportQuery } from './status-report.types';

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfYear = (year: number): Date => new Date(Date.UTC(year, 0, 1));

const getScope = (query: StatusReportQuery): { from: Date; to: Date } => {
  const yearStart = startOfYear(query.year);
  if (query.period === 'weekly') {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * DAY_MS);
    return { from: from < yearStart ? yearStart : from, to };
  }
  if (query.period === 'monthly') {
    const now = new Date();
    const month = now.getUTCFullYear() === query.year ? now.getUTCMonth() : 11;
    return { from: new Date(Date.UTC(query.year, month, 1)), to: new Date(Date.UTC(query.year, month + 1, 1)) };
  }
  return { from: yearStart, to: new Date(Date.UTC(query.year + 1, 0, 1)) };
};

const metricFor = (projects: IDomainProject[]) => ({
  count: projects.length,
  value: projects.reduce((sum, project) => sum + (project.estimatedCost ?? 0), 0),
});

// Keep dashboard reporting aligned with the read-only Kanban board. These are
// presentation buckets only: they do not alter a project's workflow status or
// its stage-transition rules.
const KANBAN_STATUS_FOR: Record<ProjectStatus, string> = {
  [ProjectStatus.SETUP_PENDING]: 'Requirements',
  [ProjectStatus.WAITING_FOR_INPUTS]: 'Approve Requirements',
  [ProjectStatus.READY_FOR_ESTIMATOR]: 'Draft Proposal',
  [ProjectStatus.ESTIMATOR_DRAFTING]: 'Review Proposal & Approval',
  [ProjectStatus.ESTIMATOR_FINAL]: 'Proposal Sent/Submitted',
  [ProjectStatus.ADMIN_PACKAGING]: 'Resubmit Proposal',
  [ProjectStatus.NEEDS_REVISION]: 'Resubmit Proposal',
};

const reportStatusFor = (status: ProjectStatus): string => KANBAN_STATUS_FOR[status];

const inScope = (project: IDomainProject, from: Date, to: Date): boolean => {
  const date = project.updatedAt ?? project.receivedDate ?? project.createdAt;
  return date >= from && date < to;
};

export class StatusReportService {
  public constructor(private readonly projectRepository: IProjectRepository) {}

  public async build(query: StatusReportQuery): Promise<StatusReportData> {
    const scope = getScope(query);
    const allProjects = await this.projectRepository.listActive();
    const visibleProjects = query.assignedEstimatorId
      ? allProjects.filter((project) => project.assignedEstimators?.some(
        (estimator) => estimator.id === query.assignedEstimatorId,
      ))
      : allProjects;
    const projects = visibleProjects.filter((project) => inScope(project, scope.from, scope.to));
    const byStatus: Record<string, { count: number; value: number }> = {};
    for (const project of projects) {
      const status = reportStatusFor(project.status);
      const current = byStatus[status] ?? { count: 0, value: 0 };
      current.count += 1;
      current.value += project.estimatedCost ?? 0;
      byStatus[status] = current;
    }

    const bands = [
      { label: 'Under $50K', min: 0, max: 50_000 },
      { label: '$50K–$100K', min: 50_000, max: 100_000 },
      { label: 'Over $100K', min: 100_000, max: null },
    ].map((band) => {
      const matching = projects.filter((project) => {
        const value = project.estimatedCost;
        return value !== null && value >= band.min && (band.max === null || value < band.max);
      });
      return { ...band, ...metricFor(matching) };
    });

    const groupRows = Array.from(new Set(projects.map((project) => project.groupId).filter((value): value is string => Boolean(value)))).map((groupId) => {
      const groupProjects = visibleProjects.filter((project) => project.groupId === groupId);
      return { groupId, projectCount: groupProjects.length, value: metricFor(groupProjects).value };
    });
    const competitiveProjects = projects.filter((project) => project.isCompetitiveBid || project.groupId);
    const previousYear = query.compareYear === undefined ? null : visibleProjects.filter((project) => {
      const date = project.updatedAt ?? project.receivedDate ?? project.createdAt;
      return date >= startOfYear(query.compareYear!) && date < startOfYear(query.compareYear! + 1);
    });
    const total = metricFor(projects);
    const previous = previousYear ? metricFor(previousYear) : null;

    return {
      period: query,
      generatedAt: new Date().toISOString(),
      scope: { from: scope.from.toISOString(), to: scope.to.toISOString() },
      pipeline: { total, byStatus },
      comparison: previous && query.compareYear !== undefined ? {
        year: query.compareYear,
        total: previous,
        change: { count: total.count - previous.count, value: total.value - previous.value },
      } : null,
      valueBands: bands,
      competitive: {
        projectCount: competitiveProjects.length,
        groupCount: groupRows.length,
        bidderCount: competitiveProjects.length,
        groups: groupRows,
        projects: competitiveProjects.map((project) => ({
          referenceNumber: project.referenceNumber,
          projectName: project.projectName,
          vendor: project.company ?? project.customerName,
          estimator: project.assignedEstimators?.[0]?.name ?? 'Unassigned',
          value: project.estimatedCost ?? 0,
          // A due date is not a quote submission date. Keep this empty until the
          // backend has an authoritative quote-submission field.
          quoteDate: null,
        })),
      },
      partners: {
        projectCount: projects.filter((project) => Boolean(project.partnerName)).length,
        available: true,
        projects: projects.filter((project) => Boolean(project.partnerName)).map((project) => ({
          referenceNumber: project.referenceNumber,
          partnerName: project.partnerName as string,
          bidCount: null,
          bidValue: null,
          submittedBidCount: null,
          submittedValue: null,
          pendingBidCount: null,
          pendingValue: null,
        })),
      },
    };
  }
}
