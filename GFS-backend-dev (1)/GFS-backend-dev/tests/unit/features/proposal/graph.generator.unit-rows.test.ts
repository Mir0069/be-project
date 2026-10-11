import ExcelJS from 'exceljs';
import {
  hasRealUnitData,
  hideEmptyUnitRows,
  applySelectedGlazingBlock,
  hideEmptyAddonUnitRows,
  findAddonSectionUnitRowBases,
  resolveFormulaCellValue,
  isAddonSectionRowAddress,
  stripFormulaKeepingCachedValue,
  setCachedValueKeepingFormula,
  bakeComputedProposalValues,
  fixAddonFormulasInRawXml,
  shiftFormulaReferences,
  resolveEffectiveFormula,
  formatInchesAsFraction,
  buildProposalIntroParagraph,
} from '../../../../src/features/proposal/excel/graph.generator';
import { createEmptySchema } from '../../../../src/features/proposal/schema-registry';
import { IProjectSchema } from '../../../../src/db/models/proposal.model';

describe('hasRealUnitData', () => {
  it('is false for a freshly seeded unit with no take-off data', () => {
    const schema = createEmptySchema() as IProjectSchema;
    expect(hasRealUnitData(schema.units['B']!)).toBe(false);
  });

  it('is true once any real field is filled in', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.units['A']!.value_width_in = 88.33;
    expect(hasRealUnitData(schema.units['A']!)).toBe(true);
  });
});

describe('hideEmptyUnitRows', () => {
  it('hides rows for units with no real data and leaves populated units visible', async () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.units['A']!.value_width_in = 88.33;
    schema.units['A']!.value_length_in = 216.75;

    const workbook = new ExcelJS.Workbook();
    const proposalSheet = workbook.addWorksheet('Proposal');
    const pricingSheet = workbook.addWorksheet('Pricing Worksheet');

    hideEmptyUnitRows(proposalSheet, pricingSheet, schema);

    expect(proposalSheet.getRow(23).hidden).toBeFalsy();
    expect(pricingSheet.getRow(115).hidden).toBeFalsy();
    for (let row = 24; row <= 32; row++) {
      expect(proposalSheet.getRow(row).hidden).toBe(true);
    }
    for (let row = 116; row <= 124; row++) {
      expect(pricingSheet.getRow(row).hidden).toBe(true);
    }
  });
});

describe('applySelectedGlazingBlock', () => {
  const seedGlazingBlocks = (sheet: ExcelJS.Worksheet) => {
    for (let row = 35; row <= 40; row++) sheet.getCell(`B${row}`).value = `no-igu ${row}`;
    for (let row = 42; row <= 51; row++) sheet.getCell(`B${row}`).value = `with-igu ${row}`;
    for (let row = 53; row <= 62; row++) sheet.getCell(`B${row}`).value = `series-2000 ${row}`;
  };

  it('keeps only the Series 2000 block for GLASS_2_0 and clears + hides the others', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type.value = 'GLASS_2_0';

    const workbook = new ExcelJS.Workbook();
    const proposalSheet = workbook.addWorksheet('Proposal');
    seedGlazingBlocks(proposalSheet);

    applySelectedGlazingBlock(proposalSheet, schema);

    for (let row = 35; row <= 40; row++) {
      expect(proposalSheet.getCell(`B${row}`).value).toBeNull();
      expect(proposalSheet.getRow(row).hidden).toBe(true);
    }
    for (let row = 42; row <= 51; row++) {
      expect(proposalSheet.getCell(`B${row}`).value).toBeNull();
      expect(proposalSheet.getRow(row).hidden).toBe(true);
    }
    for (let row = 53; row <= 62; row++) {
      expect(proposalSheet.getCell(`B${row}`).value).toBe(`series-2000 ${row}`);
      expect(proposalSheet.getRow(row).hidden).toBeFalsy();
    }
  });

  it('keeps only the Series 2000 block when frame_type is a Series 2000 variant, even if glass_type says otherwise', () => {
    // Regression case for 182 Robinson Street: frame_type=SERIES_2000_PEDESTAL
    // but glass_type=GLASS_WITH_IGU — the Series 2000 (20mm air spacer) block
    // is the one that actually applies, so frame_type must win.
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type.value = 'GLASS_WITH_IGU';
    schema.stage_3.decision.frame_type.value = 'SERIES_2000_PEDESTAL';

    const workbook = new ExcelJS.Workbook();
    const proposalSheet = workbook.addWorksheet('Proposal');
    seedGlazingBlocks(proposalSheet);

    applySelectedGlazingBlock(proposalSheet, schema);

    for (let row = 35; row <= 40; row++) {
      expect(proposalSheet.getCell(`B${row}`).value).toBeNull();
      expect(proposalSheet.getRow(row).hidden).toBe(true);
    }
    for (let row = 42; row <= 51; row++) {
      expect(proposalSheet.getCell(`B${row}`).value).toBeNull();
      expect(proposalSheet.getRow(row).hidden).toBe(true);
    }
    for (let row = 53; row <= 62; row++) {
      expect(proposalSheet.getCell(`B${row}`).value).toBe(`series-2000 ${row}`);
      expect(proposalSheet.getRow(row).hidden).toBeFalsy();
    }
  });

  it('leaves all three blocks untouched when glass_type has no known mapping', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_2.glass_type.value = 'STAIR_TREAD';

    const workbook = new ExcelJS.Workbook();
    const proposalSheet = workbook.addWorksheet('Proposal');
    seedGlazingBlocks(proposalSheet);

    applySelectedGlazingBlock(proposalSheet, schema);

    for (let row = 35; row <= 62; row++) {
      expect(proposalSheet.getRow(row).hidden).toBeFalsy();
    }
  });
});

describe('hideEmptyAddonUnitRows', () => {
  // Regression case for 182 Robinson Street: the live template has an
  // "Options" block inserted above these sections that an older reference
  // export didn't have, shifting every base row down by 5 (e.g. Seeded
  // Organic's "Unit A" row is 101 in the live template vs. 96 elsewhere).
  // The header text must be located dynamically rather than assuming a
  // fixed row offset, so this test uses shifted, non-canonical row numbers
  // to prove the lookup isn't hardcoded.
  const SHIFTED_BASES: Array<[string, number]> = [
    ['Add - Seeded Organic® anti-slip texture (Optional)', 101],
    ['Add - NanoDot® anti-slip texture (Optional)', 116],
    ['Heat Soak Testing', 129],
  ];

  it('clears + hides addon-section unit rows only for units with no real data', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.units['A']!.value_width_in = 88.33;

    const workbook = new ExcelJS.Workbook();
    const proposalSheet = workbook.addWorksheet('Proposal');
    for (const [header, base] of SHIFTED_BASES) {
      proposalSheet.getCell(`B${base - 1}`).value = header;
      for (let i = 0; i < 10; i++) {
        proposalSheet.getCell(`B${base + i}`).value = `Unit ${String.fromCharCode(65 + i)}`;
        proposalSheet.getCell(`E${base + i}`).value = 0;
      }
    }

    hideEmptyAddonUnitRows(proposalSheet, schema, findAddonSectionUnitRowBases(proposalSheet));

    for (const [, base] of SHIFTED_BASES) {
      expect(proposalSheet.getRow(base).hidden).toBeFalsy();
      expect(proposalSheet.getCell(`B${base}`).value).toBe('Unit A');
      for (let i = 1; i < 10; i++) {
        expect(proposalSheet.getRow(base + i).hidden).toBe(true);
        expect(proposalSheet.getCell(`B${base + i}`).value).toBeNull();
        expect(proposalSheet.getCell(`E${base + i}`).value).toBeNull();
      }
    }
  });
});

describe('resolveFormulaCellValue', () => {
  // Regression coverage for 182 Robinson Street: the PDF export deletes
  // every sheet but Proposal, so any formula that survives untouched and
  // points at a deleted sheet renders blank/0. These cases mirror the exact
  // formula shapes found on that project's Proposal sheet.
  const buildWorkbook = () => {
    const workbook = new ExcelJS.Workbook();
    const proposal = workbook.addWorksheet('Proposal');
    const pricing = workbook.addWorksheet('Pricing Worksheet');
    pricing.getCell('C2').value = '182 Robinson Street';
    pricing.getCell('F95').value = 73.26;
    pricing.getCell('J115').value = 30;
    return { workbook, proposal, pricing };
  };

  it('follows a single cross-sheet reference and returns the raw value (string header field)', () => {
    const { workbook, proposal } = buildWorkbook();
    proposal.getCell('K4').value = { formula: "'Pricing Worksheet'!C2" } as any;
    const result = resolveFormulaCellValue(workbook, proposal, proposal.getCell('K4').value);
    expect(result).toBe('182 Robinson Street');
  });

  it('evaluates an arithmetic expression of two cross-sheet references (Base Pricing per-unit $)', () => {
    const { workbook, proposal } = buildWorkbook();
    proposal.getCell('J80').value = { formula: "'Pricing Worksheet'!F95*'Pricing Worksheet'!J115" } as any;
    const result = resolveFormulaCellValue(workbook, proposal, proposal.getCell('J80').value);
    expect(result).toBe(73.26 * 30);
  });

  it('sums a same-sheet range once its members are resolved (Base Pricing Total)', () => {
    const { workbook, proposal } = buildWorkbook();
    proposal.getCell('J80').value = 100;
    proposal.getCell('J81').value = { formula: "'Pricing Worksheet'!F95*'Pricing Worksheet'!J115" } as any;
    for (let r = 82; r <= 89; r++) proposal.getCell(`J${r}`).value = 0;
    proposal.getCell('J90').value = { formula: 'SUM(J80:J89)' } as any;
    const result = resolveFormulaCellValue(workbook, proposal, proposal.getCell('J90').value);
    expect(result).toBe(100 + 73.26 * 30);
  });

  it('uses an already-cached result without re-deriving it', () => {
    const { workbook, proposal } = buildWorkbook();
    const value = { formula: 'TODAY()', result: '2026-09-16' } as any;
    expect(resolveFormulaCellValue(workbook, proposal, value)).toBe('2026-09-16');
  });

  it('leaves a same-sheet formula it does not specifically handle untouched', () => {
    const { workbook, proposal } = buildWorkbook();
    const value = { formula: 'AVERAGE(J80:J89)' } as any;
    expect(resolveFormulaCellValue(workbook, proposal, value)).toBe(value);
  });

  it('strips (never leaves dangling) a cross-sheet arithmetic formula it cannot fully resolve', () => {
    // Regression case: a per-unit rate cell (e.g. an empty unit's Base
    // Pricing row) whose own operand is itself an unresolvable formula.
    // Confirmed against a real workbook that leaving such a formula in
    // place makes Microsoft Graph's PDF export reject the whole file
    // (406 OfficeConversion_ContentNotSupported) once the sheet it points
    // at is deleted — it must resolve to null, never fall back to the
    // original formula object.
    const { workbook, proposal, pricing } = buildWorkbook();
    pricing.getCell('I95').value = { formula: 'SomeUnresolvableSameSheetLookup()' } as any;
    const value = { formula: "'Pricing Worksheet'!I95*'Pricing Worksheet'!J115" } as any;
    expect(resolveFormulaCellValue(workbook, proposal, value)).toBeNull();
  });
});

describe('stripFormulaKeepingCachedValue', () => {
  it('removes the <f> element but keeps the cached <v> and style', () => {
    const xml = '<row><c r="A1" s="1"/><c r="E101" s="255"><f>\'Pricing Worksheet\'!F107</f><v>0</v></c><c r="E102" s="255"/></row>';
    const result = stripFormulaKeepingCachedValue(xml, 'E101');
    expect(result).toBe('<row><c r="A1" s="1"/><c r="E101" s="255"><v>0</v></c><c r="E102" s="255"/></row>');
  });

  it('is a no-op for a self-closing (empty) cell', () => {
    const xml = '<row><c r="E102" s="255"/></row>';
    expect(stripFormulaKeepingCachedValue(xml, 'E102')).toBe(xml);
  });

  it('is a no-op when the address is not present in the XML', () => {
    const xml = '<row><c r="E101" s="255"><f>SOMETHING</f><v>1</v></c></row>';
    expect(stripFormulaKeepingCachedValue(xml, 'E999')).toBe(xml);
  });

  it('only touches the exact addressed cell, not a neighboring one', () => {
    const xml = '<c r="E101"><f>A</f><v>1</v></c><c r="E1010"><f>B</f><v>2</v></c>';
    const result = stripFormulaKeepingCachedValue(xml, 'E101');
    expect(result).toBe('<c r="E101"><v>1</v></c><c r="E1010"><f>B</f><v>2</v></c>');
  });
});

describe('isAddonSectionRowAddress', () => {
  // Regression case: a real workbook showed "A-201 / 20 / 30 / 1 / 1 / 0 / 0"
  // bleeding through in columns C-K of the NanoDot header row, right next
  // to a correct "Add - NanoDot..." label in column B — protecting only
  // column B wasn't enough, the whole row needed to be off-limits.
  it('matches every column of an addon section header row', () => {
    const bases = [101, 116, 129];
    for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      expect(isAddonSectionRowAddress(`${col}115`, bases)).toBe(true);
    }
  });

  // Regression case: a stray "y"/"Y" clobbered the static "add" label in
  // column D of two addon unit rows — protecting only column E (the $
  // amount) wasn't enough either, so the whole unit row range (base..base+9)
  // must be covered too, not just the header row above it.
  it('matches every column across the full base..base+9 unit row range', () => {
    for (const row of [116, 117, 118, 119, 120, 121, 122, 123, 124, 125]) {
      for (const col of ['B', 'D', 'E', 'K']) {
        expect(isAddonSectionRowAddress(`${col}${row}`, [116])).toBe(true);
      }
    }
  });

  it('does not match a row just past the last unit row', () => {
    expect(isAddonSectionRowAddress('B126', [116])).toBe(false);
  });

  it('does not match an unrelated row', () => {
    expect(isAddonSectionRowAddress('B14', [101, 116, 129])).toBe(false);
  });
});

describe('shiftFormulaReferences', () => {
  it('shifts relative row references but leaves absolute-column-marked ones alone', () => {
    // Regression case: NanoDot's Pricing Worksheet cell (F110) is a shared
    // formula clone of F109 (`ROUND(E109*$C109, 2)`), one row below —
    // E109 is fully relative and must shift to E110, but $C109's absolute
    // column marker means only its row shifts (to $C110), matching how
    // Excel actually fills this formula down.
    expect(shiftFormulaReferences('ROUND(E109*$C109, 2)', 1, 0)).toBe('ROUND(E110*$C110, 2)');
  });

  it('shifts relative columns for a horizontal fill and leaves absolute columns alone', () => {
    expect(shiftFormulaReferences('SUM(A1:A5)+$B$1', 0, 2)).toBe('SUM(C1:C5)+$B$1');
  });

  it('leaves a fully absolute reference untouched', () => {
    expect(shiftFormulaReferences('$C$107*2', 5, 5)).toBe('$C$107*2');
  });
});

describe('resolveEffectiveFormula', () => {
  it('returns a plain formula cell unchanged', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pricing Worksheet');
    const value = { formula: "'Pricing Worksheet'!F107" };
    expect(resolveEffectiveFormula(sheet, 'E101', value)).toBe("'Pricing Worksheet'!F107");
  });

  it('reconstructs a shared-formula clone by shifting the master\'s formula', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pricing Worksheet');
    sheet.getCell('F109').value = { formula: 'ROUND(E109*$C109, 2)', ref: 'F109:F110', shareType: 'shared' } as any;
    const cloneValue = { sharedFormula: 'F109' };
    expect(resolveEffectiveFormula(sheet, 'F110', cloneValue)).toBe('ROUND(E110*$C110, 2)');
  });

  it('returns null when the clone\'s master cannot be resolved', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pricing Worksheet');
    expect(resolveEffectiveFormula(sheet, 'F110', { sharedFormula: 'F109' })).toBeNull();
  });
});

describe('setCachedValueKeepingFormula', () => {
  it('updates an existing cached <v> without touching the <f> formula', () => {
    const xml = '<c r="K4" s="186"><f>\'Pricing Worksheet\'!C2</f><v>0</v></c>';
    const result = setCachedValueKeepingFormula(xml, 'K4', 200.16);
    expect(result).toBe('<c r="K4" s="186"><f>\'Pricing Worksheet\'!C2</f><v>200.16</v></c>');
  });

  it('adds a <v> when the formula has no cached result at all', () => {
    const xml = '<c r="F110" s="154"><f t="shared" si="27"/></c>';
    const result = setCachedValueKeepingFormula(xml, 'F110', 233.52);
    expect(result).toBe('<c r="F110" s="154"><f t="shared" si="27"/><v>233.52</v></c>');
  });

  it('is a no-op for a cell with no formula at all', () => {
    const xml = '<c r="E102" s="255"/>';
    expect(setCachedValueKeepingFormula(xml, 'E102', 5)).toBe(xml);
  });
});

describe('bakeComputedProposalValues', () => {
  it('bakes a result into the header block while preserving the live formula', async () => {
    const workbook = new ExcelJS.Workbook();
    const pricing = workbook.addWorksheet('Pricing Worksheet');
    pricing.getCell('C2').value = '182 Robinson Street';
    const proposal = workbook.addWorksheet('Proposal');
    // Stale/empty cached result, mirroring Graph's unreliable calculate step.
    proposal.getCell('K4').value = { formula: "'Pricing Worksheet'!C2" } as any;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const baked = await bakeComputedProposalValues(buffer, 'Proposal');

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(baked as any);
    const cell = reloaded.getWorksheet('Proposal')!.getCell('K4').value as any;
    expect(cell.result).toBe('182 Robinson Street');
    expect(cell.formula).toBe("'Pricing Worksheet'!C2");
  });

  it('leaves the workbook unchanged when the target sheet does not exist', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Other');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const baked = await bakeComputedProposalValues(buffer, 'Proposal');
    expect(baked).toBe(buffer);
  });
});

describe('fixAddonFormulasInRawXml', () => {
  it('computes the true value via HyperFormula instead of trusting a stale cached result', async () => {
    // Regression case for 182 Robinson Street: the addon was switched from
    // not-selected to selected, but the file's cached formula result never
    // got updated (Graph's calculate step is unreliable) — even the newest
    // regeneration still cached 0, while opening the file in a real
    // spreadsheet app (which always recalculates on open) showed the
    // correct non-zero price. Both F107 and E101 below carry a stale
    // cached `result: 0` on purpose to prove it's ignored.
    const original = new ExcelJS.Workbook();
    const pricing = original.addWorksheet('Pricing Worksheet');
    pricing.getCell('C107').value = 48;
    pricing.getCell('E107').value = 4.17;
    pricing.getCell('F107').value = { formula: 'ROUND(C107*E107,2)', result: 0 } as any;
    const proposal = original.addWorksheet('Proposal');
    proposal.getCell('E101').value = { formula: "'Pricing Worksheet'!F107", result: 0 } as any;
    proposal.getCell('K4').value = 'unrelated cell, must survive untouched';
    const originalBuffer = Buffer.from(await original.xlsx.writeBuffer());

    // Simulate the trimmed (Proposal-only) buffer the real pipeline builds
    // before calling this function.
    const trimmed = new ExcelJS.Workbook();
    await trimmed.xlsx.load(originalBuffer as any);
    trimmed.removeWorksheet(trimmed.getWorksheet('Pricing Worksheet')!.id);
    const trimmedBuffer = Buffer.from(await trimmed.xlsx.writeBuffer());

    const patched = await fixAddonFormulasInRawXml(originalBuffer, trimmedBuffer, 'Proposal', [101]);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(patched as any);
    const reloadedSheet = reloaded.getWorksheet('Proposal')!;
    expect(reloadedSheet.getCell('E101').value).toBe(200.16);
    expect(reloadedSheet.getCell('K4').value).toBe('unrelated cell, must survive untouched');
  });

  it('falls back to the cached value when the referenced sheet no longer exists', async () => {
    const original = new ExcelJS.Workbook();
    const proposal = original.addWorksheet('Proposal');
    proposal.getCell('E101').value = { formula: "'Missing Sheet'!F1", result: 42 } as any;
    const buffer = Buffer.from(await original.xlsx.writeBuffer());

    const patched = await fixAddonFormulasInRawXml(buffer, buffer, 'Proposal', [101]);

    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(patched as any);
    expect(reloaded.getWorksheet('Proposal')!.getCell('E101').value).toBe(42);
  });
});

describe('formatInchesAsFraction', () => {
  it('formats a repeating-third decimal as a mixed fraction', () => {
    expect(formatInchesAsFraction(88 + 1 / 3)).toBe('88-1/3"');
  });

  it('formats a quarter-inch decimal as a mixed fraction', () => {
    expect(formatInchesAsFraction(216.75)).toBe('216-3/4"');
  });

  it('falls back to decimal display when no clean fraction matches', () => {
    expect(formatInchesAsFraction(10.05)).toBe('10.05"');
  });

  it('renders a whole number with no fraction', () => {
    expect(formatInchesAsFraction(24)).toBe('24"');
  });
});

describe('buildProposalIntroParagraph', () => {
  const buildWorkbookWithDescriptions = (): ExcelJS.Workbook => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Proposal Descriptions');
    // proposal_number 7 -> row 10 ("EconoFrame and Gasket")
    sheet.getCell('B10').value =
      'Thank you for your interest in Glass Flooring Systems. The following quote is for (X) XX" x XX" walkable glass panels with tested anti-slip top surface. ';
    // proposal_number 11 -> row 14 ("Deck")
    sheet.getCell('B14').value =
      'Thank you for your interest in Glass Flooring Systems. The following quote is for a XX" x XX" SkyFloor® glass deck system consisting of (xx) equally sized walkable glass panels and (xx) linear feet of integrated (glass cable) railing. ';
    return workbook;
  };

  it('substitutes quantity and dimension placeholders from the primary unit', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_3.decision.proposal_number.value = 7;
    schema.units['A']!.value_width_in = 88 + 1 / 3;
    schema.units['A']!.value_length_in = 216.75;
    schema.units['A']!.value_num_units = 1;

    const paragraph = buildProposalIntroParagraph(buildWorkbookWithDescriptions(), schema);

    expect(paragraph).toContain('(1 Qty.)');
    expect(paragraph).toContain('88-1/3" x 216-3/4"');
  });

  it('substitutes the panel-count placeholder but leaves unrelated (xx) placeholders untouched', () => {
    const schema = createEmptySchema() as IProjectSchema;
    schema.stage_3.decision.proposal_number.value = 11;
    schema.units['A']!.value_width_in = 88 + 1 / 3;
    schema.units['A']!.value_length_in = 216.75;
    schema.units['A']!.value_panel_count = 14;

    const paragraph = buildProposalIntroParagraph(buildWorkbookWithDescriptions(), schema);

    expect(paragraph).toContain('fourteen (14) equally sized walkable glass panels');
    expect(paragraph).toContain('(xx) linear feet');
  });

  it('returns null when proposal_number has not been decided yet', () => {
    const schema = createEmptySchema() as IProjectSchema;
    const paragraph = buildProposalIntroParagraph(buildWorkbookWithDescriptions(), schema);
    expect(paragraph).toBeNull();
  });
});
