import { createEmptySchema } from '@features/proposal/schema-registry';
import { applyPatches } from '@features/proposal/schema-merge.engine';
import { collectFeedbackRows } from '@features/proposal/feedback-export';
import { stripFeedback, type FieldPatchFeedback, type PatchAuthor } from '@features/proposal/feedback';
import { fieldPatchSchema, patchStage7CostSchema } from '@features/proposal/proposal.validation';
import { MAX_FEEDBACK_PER_FIELD, type IFieldFeedbackEntry, type IProjectSchema } from '@db/models/proposal.model';

const ESTIMATOR: PatchAuthor = { source: 'ESTIMATOR', updatedBy: 'user-1', authorRole: 'ESTIMATOR' };
const FEEDBACK: FieldPatchFeedback = { reasonCode: 'AI_READ_IT_WRONG', note: '  drawing says 96  ' };

const schemaWithHeader = (): IProjectSchema => {
  const schema = createEmptySchema();
  schema.stage_1.project_name.value = '1500 CLINTON';
  schema.stage_1.project_name.reasoning = ['Title block explicitly lists the project name.'];
  schema.stage_1.project_name.confidence = 'high';
  return schema;
};

const feedbackOf = (schema: IProjectSchema): IFieldFeedbackEntry[] =>
  (schema.stage_1.project_name._feedback ?? []) as IFieldFeedbackEntry[];

const patchName = (
  schema: IProjectSchema,
  value: unknown,
  feedback: FieldPatchFeedback = FEEDBACK,
  meta: PatchAuthor = ESTIMATOR,
): IProjectSchema =>
  applyPatches(schema, [{ fieldPath: 'stage_1.project_name', value, feedback }], meta).nextSchema;

describe('field feedback — capture on estimator edits', () => {
  it('appends one entry to _feedback when the patch carries feedback and the field had a previous value', () => {
    const next = patchName(schemaWithHeader(), '1500 Clinton Street');

    expect(feedbackOf(next)).toHaveLength(1);
    expect(feedbackOf(next)[0]).toMatchObject({
      reason_code: 'AI_READ_IT_WRONG',
      note: 'drawing says 96',
      author_id: 'user-1',
      author_role: 'ESTIMATOR',
      stage: 1,
    });
  });

  it('records previous_value, ai_reasoning and ai_confidence as they were BEFORE the write', () => {
    const next = patchName(schemaWithHeader(), '1500 Clinton Street');
    const entry = feedbackOf(next)[0]!;

    expect(entry.previous_value).toBe('1500 CLINTON');
    expect(entry.new_value).toBe('1500 Clinton Street');
    expect(entry.ai_reasoning).toEqual(['Title block explicitly lists the project name.']);
    expect(entry.ai_confidence).toBe('high');
    expect(next.stage_1.project_name.value).toBe('1500 Clinton Street');
  });

  it('does not create a _feedback key when the patch carries no feedback', () => {
    const next = applyPatches(
      schemaWithHeader(),
      [{ fieldPath: 'stage_1.project_name', value: 'No reason given' }],
      ESTIMATOR,
    ).nextSchema;

    expect(next.stage_1.project_name._feedback).toBeUndefined();
  });

  it('does not append when the previous value was null', () => {
    const next = patchName(createEmptySchema(), 'First value');

    expect(next.stage_1.project_name._feedback).toBeUndefined();
    expect(next.stage_1.project_name.value).toBe('First value');
  });

  it('does not append when the previous value was an empty string', () => {
    const schema = createEmptySchema();
    schema.stage_1.project_name.value = '';

    expect(patchName(schema, 'First real value').stage_1.project_name._feedback).toBeUndefined();
  });

  it('never writes a key named status inside an entry', () => {
    const entry = feedbackOf(patchName(schemaWithHeader(), 'Changed'))[0]!;

    expect(Object.keys(entry)).not.toContain('status');
    expect(Object.keys(entry).sort()).toEqual(
      [
        'ai_confidence',
        'ai_reasoning',
        'author_id',
        'author_role',
        'created_at',
        'new_value',
        'note',
        'previous_value',
        'reason_code',
        'stage',
      ].sort(),
    );
  });

  it('keeps at most MAX_FEEDBACK_PER_FIELD entries, dropping the oldest first', () => {
    let schema = schemaWithHeader();
    for (let i = 0; i < MAX_FEEDBACK_PER_FIELD + 5; i += 1) {
      schema = patchName(schema, `value-${i}`, { reasonCode: 'OTHER', note: `note-${i}` });
    }

    const entries = feedbackOf(schema);
    expect(entries).toHaveLength(MAX_FEEDBACK_PER_FIELD);
    expect(entries[0]!.note).toBe('note-5');
    expect(entries.at(-1)!.note).toBe(`note-${MAX_FEEDBACK_PER_FIELD + 4}`);
  });

  it('ignores feedback on a patch whose source is AI', () => {
    const next = patchName(schemaWithHeader(), 'AI rewrite', FEEDBACK, {
      source: 'AI',
      updatedBy: 'AI',
      authorRole: 'AI',
    });

    expect(next.stage_1.project_name._feedback).toBeUndefined();
  });

  it('writes created_at as an ISO string that survives a second applyPatches round trip', () => {
    const once = patchName(schemaWithHeader(), 'Changed once');
    const twice = patchName(once, 'Changed twice', { reasonCode: 'OTHER' });
    const entry = feedbackOf(twice)[0]!;

    expect(typeof entry.created_at).toBe('string');
    expect(new Date(entry.created_at).toISOString()).toBe(entry.created_at);
  });

  it('stores a null note when the estimator gave a category only', () => {
    const entry = feedbackOf(patchName(schemaWithHeader(), 'Changed', { reasonCode: 'COMPANY_STANDARD' }))[0]!;

    expect(entry.note).toBeNull();
  });
});

describe('field feedback — takeoff rows', () => {
  const seededUnits = (): IProjectSchema => {
    const schema = createEmptySchema();
    schema.units['A']!.value_width_in = 40;
    schema.units['A']!.value_length_in = 90;
    schema.units['A']!.value_panel_count = 2;
    return schema;
  };

  it('writes a single row entry when three columns of unit A change in one call', () => {
    const { nextSchema } = applyPatches(
      seededUnits(),
      [
        { fieldPath: 'units.A.value_width_in', value: 48, feedback: { reasonCode: 'AI_READ_IT_WRONG' } },
        { fieldPath: 'units.A.value_length_in', value: 96, feedback: { reasonCode: 'AI_READ_IT_WRONG' } },
        { fieldPath: 'units.A.value_panel_count', value: 3, feedback: { reasonCode: 'AI_READ_IT_WRONG' } },
      ],
      ESTIMATOR,
    );

    expect(nextSchema.units['A']!._feedback).toHaveLength(1);
    expect(nextSchema.units['A']!._feedback![0]!.stage).toBe(4);
  });

  it('records changed_columns listing exactly the columns that changed', () => {
    const changedColumns = ['value_width_in', 'value_length_in'];
    const { nextSchema } = applyPatches(
      seededUnits(),
      [
        { fieldPath: 'units.A.value_width_in', value: 48, feedback: { reasonCode: 'OTHER', changedColumns } },
        { fieldPath: 'units.A.value_length_in', value: 96, feedback: { reasonCode: 'OTHER', changedColumns } },
      ],
      ESTIMATOR,
    );

    expect(nextSchema.units['A']!._feedback![0]!.changed_columns).toEqual(changedColumns);
  });

  it('keeps separate entries for two different units in one call', () => {
    const schema = seededUnits();
    schema.units['B']!.value_width_in = 20;

    const { nextSchema } = applyPatches(
      schema,
      [
        { fieldPath: 'units.A.value_width_in', value: 48, feedback: { reasonCode: 'OTHER' } },
        { fieldPath: 'units.B.value_width_in', value: 24, feedback: { reasonCode: 'OTHER' } },
      ],
      ESTIMATOR,
    );

    expect(nextSchema.units['A']!._feedback).toHaveLength(1);
    expect(nextSchema.units['B']!._feedback).toHaveLength(1);
  });
});

describe('field feedback — request validation', () => {
  it('accepts a patch carrying a valid reason code', () => {
    const parsed = fieldPatchSchema.parse({
      fieldPath: 'stage_1.project_name',
      value: 'x',
      feedback: { reasonCode: 'WRONG_SOURCE', note: 'wrong page' },
    });

    expect(parsed.feedback?.reasonCode).toBe('WRONG_SOURCE');
  });

  it('rejects a reason_code outside the allowed enum', () => {
    expect(() =>
      fieldPatchSchema.parse({ fieldPath: 'stage_1.project_name', value: 'x', feedback: { reasonCode: 'BECAUSE' } }),
    ).toThrow();
  });

  it('trims the note and rejects one longer than 500 characters', () => {
    const parsed = fieldPatchSchema.parse({
      fieldPath: 'stage_1.project_name',
      value: 'x',
      feedback: { reasonCode: 'OTHER', note: '  spaced  ' },
    });
    expect(parsed.feedback?.note).toBe('spaced');

    expect(() =>
      fieldPatchSchema.parse({
        fieldPath: 'stage_1.project_name',
        value: 'x',
        feedback: { reasonCode: 'OTHER', note: 'x'.repeat(501) },
      }),
    ).toThrow();
  });

  it('accepts feedback on a stage 7 cost patch', () => {
    const parsed = patchStage7CostSchema.parse({
      params: { projectId: '6a7a00bd2e3626798006e0d5' },
      body: { cell: 'C10', cost: 124.32, feedback: { reasonCode: 'COMPANY_STANDARD' } },
    });

    expect(parsed.body.feedback?.reasonCode).toBe('COMPANY_STANDARD');
  });
});

describe('field feedback — version snapshots', () => {
  it('strips _feedback from a snapshot while leaving the live schema untouched', () => {
    const live = patchName(schemaWithHeader(), 'Changed');
    const snapshot = JSON.parse(JSON.stringify(live.stage_1));

    stripFeedback(snapshot);

    expect(snapshot.project_name._feedback).toBeUndefined();
    expect(snapshot.project_name.value).toBe('Changed');
    expect(feedbackOf(live)).toHaveLength(1);
  });

  it('strips cost_feedback and nested unit feedback anywhere in the tree', () => {
    const snapshot: Record<string, unknown> = {
      units: { A: { _feedback: [{ reason_code: 'OTHER' }], value_width_in: 48 } },
      stage_7: { cost_feedback: { C10: [{ reason_code: 'OTHER' }] }, cost_overrides: { C10: 130 } },
    };

    stripFeedback(snapshot);

    expect(JSON.stringify(snapshot)).not.toContain('feedback');
    expect(JSON.stringify(snapshot)).toContain('48');
  });
});

describe('field feedback — export', () => {
  const project = { projectId: 'p1', referenceNumber: 'GFS-2026-1008', projectName: '1500 Clinton Street' };

  it('emits one row per entry, with project reference, stage and field path', () => {
    const schema = patchName(schemaWithHeader(), '1500 Clinton Street');
    const rows = collectFeedbackRows(schema, project);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectReference: 'GFS-2026-1008',
      stage: 1,
      fieldPath: 'stage_1.project_name',
      fieldLabel: 'Project Name',
      reasonCode: 'AI_READ_IT_WRONG',
      previousValue: '1500 CLINTON',
      newValue: '1500 Clinton Street',
      aiReasoning: 'Title block explicitly lists the project name.',
    });
  });

  it('includes takeoff rows and stage 7 cost cells alongside plain fields', () => {
    const schema = patchName(schemaWithHeader(), 'Changed');
    schema.units['A']!.value_width_in = 40;
    const withUnit = applyPatches(
      schema,
      [{ fieldPath: 'units.A.value_width_in', value: 48, feedback: { reasonCode: 'OTHER' } }],
      ESTIMATOR,
    ).nextSchema;

    withUnit.stage_7 = {
      status: 'PENDING',
      cost_overrides: { C10: 130 },
      cost_feedback: {
        C10: [
          {
            reason_code: 'COMPANY_STANDARD',
            note: null,
            previous_value: 124.32,
            new_value: 130,
            ai_reasoning: null,
            ai_confidence: null,
            author_id: 'user-1',
            author_role: 'ESTIMATOR',
            stage: 7,
            created_at: new Date().toISOString(),
          },
        ],
      },
    };

    const paths = collectFeedbackRows(withUnit, project).map((r) => r.fieldPath);
    expect(paths).toContain('stage_1.project_name');
    expect(paths).toContain('units.A');
    expect(paths).toContain('stage_7.cost_overrides.C10');
  });

  it('returns nothing for a schema with no feedback', () => {
    expect(collectFeedbackRows(createEmptySchema(), project)).toEqual([]);
    expect(collectFeedbackRows(null, project)).toEqual([]);
  });
});
