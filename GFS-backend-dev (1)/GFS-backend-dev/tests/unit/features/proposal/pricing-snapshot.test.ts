import ExcelJS from 'exceljs';
import { extractPricingSnapshot } from '@features/proposal/excel/pricing-snapshot';

describe('extractPricingSnapshot', () => {
  it('reads calculated pricing totals by their worksheet labels', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pricing Worksheet');
    worksheet.getCell('B82').value = 'Sub Total';
    worksheet.getCell('AH82').value = { formula: 'SUM(F82:AG82)', result: 1000 };
    worksheet.getCell('B90').value = 'TOTAL';
    worksheet.getCell('AH90').value = { formula: 'SUM(F82:F89)', result: 1250 };
    worksheet.getCell('B93').value = 'FINAL PRICE';
    worksheet.getCell('AH93').value = { formula: 'SUM(F90+F91-F92)', result: 1500 };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(extractPricingSnapshot(buffer)).resolves.toEqual({
      subtotal: 1000,
      total: 1250,
      final_price: 1500,
    });
  });

  it('returns null when a calculated final price is unavailable', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Pricing Worksheet');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(extractPricingSnapshot(buffer)).resolves.toBeNull();
  });

  it('sums unit totals instead of selecting only the rightmost populated unit', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pricing Worksheet');
    worksheet.getCell('B95').value = 'FINAL PRICE';
    worksheet.getCell('E95').value = { formula: 'F95*J115', result: 1000 };
    worksheet.getCell('F95').value = { formula: 'F92', result: 1000 };
    worksheet.getCell('H95').value = { formula: 'I95*J116', result: 250 };
    worksheet.getCell('I95').value = { formula: 'I92', result: 250 };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(extractPricingSnapshot(buffer)).resolves.toMatchObject({ final_price: 1250 });
  });

  it('sums only active unit columns when activeUnitCount is specified', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pricing Worksheet');
    worksheet.getCell('B95').value = 'FINAL PRICE';
    // Unit A (col F)
    worksheet.getCell('F95').value = { formula: 'F92', result: 3422.27 };
    // Inactive Unit B (col I) template pre-filled formula
    worksheet.getCell('I95').value = { formula: 'I92', result: 417.89 };
    // Inactive Unit C (col L) template pre-filled formula
    worksheet.getCell('L95').value = { formula: 'L92', result: 417.89 };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    // Without activeUnitCount, it sums all 3 = 4258.05
    await expect(extractPricingSnapshot(buffer)).resolves.toMatchObject({ final_price: 4258.05 });

    // With activeUnitCount = 1, it only sums Unit A = 3422.27
    await expect(extractPricingSnapshot(buffer, 1)).resolves.toMatchObject({ final_price: 3422.27 });
  });

  it('treats a zero final price as unavailable until the workbook is calculated', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pricing Worksheet');
    worksheet.getCell('B93').value = 'FINAL PRICE';
    worksheet.getCell('AH93').value = { formula: 'SUM(F90+F91-F92)', result: 0 };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(extractPricingSnapshot(buffer)).resolves.toBeNull();
  });
});
