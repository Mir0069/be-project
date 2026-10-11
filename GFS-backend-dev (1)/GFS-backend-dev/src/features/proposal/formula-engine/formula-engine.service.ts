import { IProjectSchema } from '@db/models/proposal.model';
import { FieldPatch } from '../schema-merge.engine';

export class FormulaEngineService {
  /**
   * Recalculates panel count, total sqft, weight, perimeter, and silicone tubes
   * using the same dimensions as the Pricing Worksheet take-off formulas.
   * Returns a list of FieldPatch to be applied to the schema.
   */
  async recalculate(schema: IProjectSchema): Promise<FieldPatch[]> {
    const patches: FieldPatch[] = [];

    // 1. Calculate panel count, total sqft, and perimeter from approved takeoff units.
    let totalPanelCount = 0;
    let totalSqft = 0;
    let perimeterLf = 0;

    for (const unit of Object.values(schema.units)) {
      if (unit.status !== 'APPROVED') continue;
      
      const width = Number(unit.value_width_in) || 0;
      const length = Number(unit.value_length_in) || 0;
      const panelCount = Number(unit.value_panel_count) || 0;
      const numUnits = Number(unit.value_num_units) || 1;

      totalPanelCount += panelCount * numUnits;
      // Pricing Worksheet H115:H124 is width × length ÷ 144. Panel count
      // remains a separate take-off value and is not multiplied into sqft.
      totalSqft += (width * length) / 144;

      // Pricing Worksheet I115:I124 is the perimeter of the take-off unit.
      perimeterLf += (2 * (width + length)) / 12;
    }

    // 2. Calculate weight based on glass type using GFS structural glass standards
    const rawGlassType = schema.stage_2?.glass_type?.value;
    const glassType = String(rawGlassType ?? '').toUpperCase().trim();
    let weightPerSqft = 15.0; // GFS standard default fallback

    if (glassType === 'GLASS_WITH_IGU' || glassType.includes('WITH IGU')) {
      weightPerSqft = 20.0;
    } else if (glassType === 'GLASS_2_0' || glassType.includes('2.0')) {
      weightPerSqft = 21.0;
    } else if (glassType === 'GLASS_NO_IGU' || glassType.includes('NO IGU')) {
      weightPerSqft = 15.0;
    } else if (glassType === 'STAIR_TREAD' || glassType.includes('STAIR')) {
      weightPerSqft = 15.0;
    } else if (
      glassType === 'NON_WALKABLE' ||
      glassType.includes('NON-WALKABLE') ||
      glassType.includes('NON_WALKABLE') ||
      glassType.includes('NON WALKABLE')
    ) {
      weightPerSqft = 15.0;
    } else {
      weightPerSqft = 15.0;
    }

    const totalWeight = totalSqft * weightPerSqft;

    // 3. Silicone is a manual/AI quantity in the Pricing Worksheet (E64),
    // not a worksheet formula. Preserve an approved value and only provide
    // the existing perimeter-based estimate when no value is available yet.
    const existingSiliconeRaw = schema.stage_5.calculated.silicone_tubes?.value;
    const existingSiliconeTubes = existingSiliconeRaw == null
      ? null
      : Number(existingSiliconeRaw);
    const siliconeTubes = existingSiliconeTubes !== null && Number.isFinite(existingSiliconeTubes)
      ? existingSiliconeTubes
      : Math.ceil(perimeterLf / 10);

    // Keep the aggregate panel count in the stage 4 field used by the UI and pricing flow.
    patches.push({
      fieldPath: 'stage_4.takeoff.panel_count',
      value: totalPanelCount,
      status: 'APPROVED',
    });

    // Create patches for stage_5.calculated.*
    patches.push({ fieldPath: 'stage_5.calculated.total_sqft', value: parseFloat(totalSqft.toFixed(2)) });
    patches.push({ fieldPath: 'stage_5.calculated.total_weight', value: parseFloat(totalWeight.toFixed(2)) });
    patches.push({ fieldPath: 'stage_5.calculated.perimeter_lf', value: parseFloat(perimeterLf.toFixed(2)) });
    patches.push({ fieldPath: 'stage_5.calculated.silicone_tubes', value: siliconeTubes });

    // Also resolve heat_soak_testing if it is pending and we have a weight threshold
    const hstStatus = schema.stage_5.addons.heat_soak_testing.status;
    if (hstStatus === 'PENDING') {
      let hstValue = 'n';
      if (totalWeight > 600) hstValue = 'y';
      else if (totalWeight > 400) hstValue = 'MANUAL';
      
      patches.push({ fieldPath: 'stage_5.addons.heat_soak_testing', value: hstValue });
    }

    return patches;
  }
}
