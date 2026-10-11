import type { IFieldFeedbackEntry, IProjectSchema } from '@db/models/proposal.model';

import { getFieldDefinition } from './schema-registry';
import { FINAL_PARAMETERS_SCHEMA } from './schema/final-parameters.schema';

export interface FeedbackExportRow {
  projectReference: string;
  projectName: string;
  projectId: string;
  stage: number;
  fieldPath: string;
  fieldLabel: string;
  reasonCode: string;
  note: string | null;
  previousValue: unknown;
  newValue: unknown;
  aiReasoning: string | null;
  aiConfidence: string | null;
  changedColumns: string | null;
  authorId: string;
  authorRole: string;
  createdAt: string;
}

export interface FeedbackExportProject {
  projectId: string;
  referenceNumber: string;
  projectName: string;
}

const costCellLabels = new Map<string, string>(
  FINAL_PARAMETERS_SCHEMA.flatMap((category) => category.fields.map((f) => [f.cell, f.label] as const)),
);

const labelFor = (fieldPath: string): string => {
  const definition = getFieldDefinition(fieldPath);
  if (definition) return definition.label;

  const unit = /^units\.([A-J])$/.exec(fieldPath);
  if (unit) return `Takeoff unit ${unit[1]}`;

  const cost = /^stage_7\.cost_overrides\.(.+)$/.exec(fieldPath);
  if (cost) return costCellLabels.get(cost[1]!) ?? cost[1]!;

  return fieldPath;
};

const toRow = (
  project: FeedbackExportProject,
  fieldPath: string,
  entry: IFieldFeedbackEntry,
): FeedbackExportRow => ({
  projectReference: project.referenceNumber,
  projectName: project.projectName,
  projectId: project.projectId,
  stage: entry.stage,
  fieldPath,
  fieldLabel: labelFor(fieldPath),
  reasonCode: entry.reason_code,
  note: entry.note ?? null,
  previousValue: entry.previous_value ?? null,
  newValue: entry.new_value ?? null,
  aiReasoning: entry.ai_reasoning?.join(' | ') ?? null,
  aiConfidence: entry.ai_confidence ?? null,
  changedColumns: entry.changed_columns?.join(',') ?? null,
  authorId: entry.author_id,
  authorRole: entry.author_role,
  createdAt: entry.created_at,
});

/**
 * Flatten every feedback entry in one proposal schema into export rows: the
 * `_feedback` arrays on fields and takeoff rows, plus stage 7's cost_feedback map.
 */
export const collectFeedbackRows = (
  schema: IProjectSchema | null | undefined,
  project: FeedbackExportProject,
): FeedbackExportRow[] => {
  if (!schema) return [];
  const rows: FeedbackExportRow[] = [];

  const walk = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;

    if (Array.isArray(record['_feedback'])) {
      for (const entry of record['_feedback'] as IFieldFeedbackEntry[]) {
        rows.push(toRow(project, path, entry));
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (key === '_feedback' || key === '_meta') continue;
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(schema, '');

  const costFeedback = schema.stage_7?.cost_feedback ?? {};
  for (const [cell, entries] of Object.entries(costFeedback)) {
    for (const entry of entries) {
      rows.push(toRow(project, `stage_7.cost_overrides.${cell}`, entry));
    }
  }

  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

const CSV_COLUMNS: Array<keyof FeedbackExportRow> = [
  'projectReference',
  'projectName',
  'stage',
  'fieldPath',
  'fieldLabel',
  'reasonCode',
  'note',
  'previousValue',
  'newValue',
  'aiReasoning',
  'aiConfidence',
  'changedColumns',
  'authorId',
  'authorRole',
  'createdAt',
];

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

export const toCsv = (rows: FeedbackExportRow[]): string =>
  [CSV_COLUMNS.join(','), ...rows.map((row) => CSV_COLUMNS.map((c) => csvCell(row[c])).join(','))].join('\n');
