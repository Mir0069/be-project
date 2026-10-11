import type { IProjectSchema } from '@db/models/proposal.model';
import type { FieldChange } from '@db/models/pending-change-approval.model';

/**
 * Change Detection Service
 * 
 * Compares incoming extracted data with existing project schema to detect
 * meaningful changes and generate reasoning about why re-triggering may be needed.
 */

export interface DetectedChange {
  fieldPath: string;
  previousValue: any;
  newValue: any;
  fieldName: string;
  fieldType: string;
  significance: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  aiReasoning?: string; // AI-provided reasoning for this specific change
}

export interface ChangeDetectionResult {
  hasChanges: boolean;
  changes: DetectedChange[];
  overallReasoning: string;
  confidence: number;
}

export class ChangeDetectionService {
  /**
   * Detect changes between existing schema and new extracted data
   */
  public detectChanges(
    existingSchema: IProjectSchema,
    newExtractedData: any
  ): ChangeDetectionResult {
    const changes: DetectedChange[] = [];
    
    // Define key fields to monitor for changes
    const keyFields = this.getKeyFieldMappings();
    
    for (const mapping of keyFields) {
      const existingValue = this.getNestedValue(existingSchema, mapping.existingPath);
      const newValue = this.getNestedValue(newExtractedData, mapping.newPath);
      
      if (this.hasSignificantChange(existingValue, newValue, mapping.fieldType)) {
        // Extract AI reasoning from the new extraction data
        const aiReasoning = this.extractAiReasoning(newExtractedData, mapping.newPath);
        
        const change: DetectedChange = {
          fieldPath: mapping.existingPath,
          previousValue: existingValue,
          newValue: newValue,
          fieldName: mapping.displayName,
          fieldType: mapping.fieldType,
          significance: mapping.significance,
          reasoning: this.generateFieldReasoning(
            mapping.displayName,
            existingValue,
            newValue,
            mapping.significance,
            aiReasoning
          ),
          // Include AI reasoning from extraction
          aiReasoning: aiReasoning,
        };
        changes.push(change);
      }
    }
    
    // If no changes detected, return early
    if (changes.length === 0) {
      return {
        hasChanges: false,
        changes: [],
        overallReasoning: 'No meaningful changes detected between existing project data and new information.',
        confidence: 0.9,
      };
    }
    
    // Generate overall reasoning
    const overallReasoning = this.generateOverallReasoning(changes);
    const confidence = this.calculateConfidence(changes);
    
    return {
      hasChanges: true,
      changes,
      overallReasoning,
      confidence,
    };
  }
  
  /**
   * Convert detected changes to the format expected by the database model
   */
  public toFieldChanges(changes: DetectedChange[]): FieldChange[] {
    return changes.map(change => ({
      fieldPath: change.fieldPath,
      previousValue: change.previousValue,
      newValue: change.newValue,
      fieldName: change.fieldName,
      fieldType: change.fieldType,
      aiReasoning: change.aiReasoning,
    }));
  }
  
  private getKeyFieldMappings() {
    return [
      // Stage 1 - Basic Project Info
      {
        displayName: 'Project Name',
        existingPath: 'stage_1.project_name.value',
        newPath: 'stage_1.project_name.value',
        fieldType: 'string',
        significance: 'MEDIUM' as const,
      },
      {
        displayName: 'Project Address',
        existingPath: 'stage_1.project_address.value',
        newPath: 'stage_1.project_address.value',
        fieldType: 'string',
        significance: 'MEDIUM' as const,
      },
      
      // Stage 2 - Glass Type
      {
        displayName: 'Glass Type',
        existingPath: 'stage_2.glass_type.value',
        newPath: 'stage_2.glass_type.value',
        fieldType: 'string',
        significance: 'HIGH' as const,
      },
      
      // Stage 3 - Frame Type
      {
        displayName: 'Frame Type',
        existingPath: 'stage_3.decision.frame_type.value',
        newPath: 'stage_3.decision.frame_type.value',
        fieldType: 'string',
        significance: 'HIGH' as const,
      },
      {
        displayName: 'Assembly Type',
        existingPath: 'stage_3.decision.assembly_type.value',
        newPath: 'stage_3.decision.assembly_type.value',
        fieldType: 'string',
        significance: 'HIGH' as const,
      },
      {
        displayName: 'Install Type',
        existingPath: 'stage_3.decision.install_type.value',
        newPath: 'stage_3.decision.install_type.value',
        fieldType: 'string',
        significance: 'MEDIUM' as const,
      },
      
      // Stage 4 - Cross Beam & Panels
      {
        displayName: 'Cross Beam Requirement',
        existingPath: 'stage_4.crossbeam.value',
        newPath: 'stage_4.crossbeam.value',
        fieldType: 'boolean',
        significance: 'HIGH' as const,
      },
      {
        displayName: 'Panel Count',
        existingPath: 'stage_4.takeoff.panel_count.value',
        newPath: 'stage_4.takeoff.panel_count.value',
        fieldType: 'number',
        significance: 'HIGH' as const,
      },
      
      // Stage 5 - Add-ons
      {
        displayName: 'Duty Add-on',
        existingPath: 'stage_5.addons.duty.value',
        newPath: 'stage_5.addons.duty.value',
        fieldType: 'boolean',
        significance: 'MEDIUM' as const,
      },
      {
        displayName: 'Heat Soak Testing',
        existingPath: 'stage_5.addons.heat_soak_testing.value',
        newPath: 'stage_5.addons.heat_soak_testing.value',
        fieldType: 'boolean',
        significance: 'MEDIUM' as const,
      },
      {
        displayName: 'Nanodot Add-on',
        existingPath: 'stage_5.addons.nanodot.value',
        newPath: 'stage_5.addons.nanodot.value',
        fieldType: 'boolean',
        significance: 'MEDIUM' as const,
      },
      {
        displayName: 'Krypton Gas',
        existingPath: 'stage_5.addons.krypton_gas.value',
        newPath: 'stage_5.addons.krypton_gas.value',
        fieldType: 'boolean',
        significance: 'MEDIUM' as const,
      },
      {
        displayName: 'Custom Shape',
        existingPath: 'stage_5.addons.custom_shape.value',
        newPath: 'stage_5.addons.custom_shape.value',
        fieldType: 'boolean',
        significance: 'MEDIUM' as const,
      },
    ];
  }
  
  private getNestedValue(obj: any, path: string): any {
    if (!obj) return undefined;

    // 1. Try exact nested path
    let val = path.split('.').reduce((current, key) => current?.[key], obj);
    if (val !== undefined && val !== null) return val;

    // 2. If path ends with '.value', try without '.value'
    if (path.endsWith('.value')) {
      const parentPath = path.slice(0, -6);
      val = parentPath.split('.').reduce((current, key) => current?.[key], obj);
      if (val !== undefined && val !== null && typeof val !== 'object') return val;
      if (val !== undefined && val !== null && typeof val === 'object' && val.value !== undefined) return val.value;
    }

    // 3. Fallback: Search for the field key recursively in obj
    const pathKeys = path.split('.');
    const fieldKey = pathKeys.length > 1 && pathKeys[pathKeys.length - 1] === 'value'
      ? pathKeys[pathKeys.length - 2]
      : pathKeys[pathKeys.length - 1];

    if (!fieldKey) return undefined;

    const findDeepKey = (target: any, searchKey: string): any => {
      if (!target || typeof target !== 'object') return undefined;
      if (searchKey in target) {
        const found = target[searchKey];
        if (found !== null && typeof found === 'object' && 'value' in found) return found.value;
        return found;
      }
      for (const k of Object.keys(target)) {
        if (typeof target[k] === 'object' && target[k] !== null) {
          const res = findDeepKey(target[k], searchKey);
          if (res !== undefined) return res;
        }
      }
      return undefined;
    };

    return findDeepKey(obj, fieldKey);
  }
  
  private hasSignificantChange(
    existingValue: any,
    newValue: any,
    fieldType: string
  ): boolean {
    // If both values are undefined/null, no change
    if (existingValue === undefined || existingValue === null) {
      if (newValue === undefined || newValue === null) return false;
      return true; // New value appeared
    }
    
    if (newValue === undefined || newValue === null) {
      return true; // Value disappeared
    }
    
    // Type-specific comparison
    switch (fieldType) {
      case 'number':
        return Math.abs(Number(existingValue) - Number(newValue)) > 0.01;
      case 'boolean':
        return Boolean(existingValue) !== Boolean(newValue);
      case 'string':
        return String(existingValue).trim() !== String(newValue).trim();
      default:
        return JSON.stringify(existingValue) !== JSON.stringify(newValue);
    }
  }
  
  private generateFieldReasoning(
    fieldName: string,
    previousValue: any,
    newValue: any,
    significance: string,
    aiReasoning?: string
  ): string {
    const prevStr = this.formatValue(previousValue);
    const newStr = this.formatValue(newValue);
    
    let impact = '';
    if (significance === 'HIGH') {
      impact = 'This change will significantly affect downstream calculations, glass requirements, frame requirements, and pricing.';
    } else if (significance === 'MEDIUM') {
      impact = 'This change may affect downstream calculations and pricing.';
    } else {
      impact = 'This change has minor impact on the overall proposal.';
    }
    
    // If AI reasoning is provided, use it as the primary reasoning
    if (aiReasoning && aiReasoning.trim().length > 0) {
      return `AI Analysis: ${aiReasoning}. System: ${fieldName} changed from "${prevStr}" to "${newStr}". ${impact}`;
    }
    
    return `${fieldName} changed from "${prevStr}" to "${newStr}". ${impact}`;
  }
  
  private generateOverallReasoning(changes: DetectedChange[]): string {
    if (changes.length === 0) {
      return 'No changes detected.';
    }
    
    const highSignificance = changes.filter(c => c.significance === 'HIGH').length;
    const mediumSignificance = changes.filter(c => c.significance === 'MEDIUM').length;
    
    let reasoning = `Detected ${changes.length} change(s) in the incoming information: `;
    
    if (highSignificance > 0) {
      reasoning += `${highSignificance} high-impact change(s)`;
      if (mediumSignificance > 0) {
        reasoning += ` and ${mediumSignificance} medium-impact change(s)`;
      }
    } else if (mediumSignificance > 0) {
      reasoning += `${mediumSignificance} medium-impact change(s)`;
    }
    
    reasoning += '. These changes may affect the project proposal and require review before re-processing.';
    
    return reasoning;
  }
  
  private calculateConfidence(changes: DetectedChange[]): number {
    if (changes.length === 0) return 0.9;
    
    // Higher confidence if multiple high-significance changes are detected
    const highSignificanceCount = changes.filter(c => c.significance === 'HIGH').length;
    const baseConfidence = 0.7;
    const significanceBonus = (highSignificanceCount / changes.length) * 0.2;
    
    return Math.min(baseConfidence + significanceBonus, 0.95);
  }
  
  private formatValue(value: any): string {
    if (value === undefined || value === null) return 'none';
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'number') return value.toString();
    return String(value);
  }
  
  /**
   * Extract AI reasoning from the new extraction data for a specific field path
   */
  private extractAiReasoning(newExtractedData: any, fieldPath: string): string | undefined {
    if (!newExtractedData) return undefined;
    
    // Navigate to the field in the new extraction data
    const fieldObj = this.getNestedValue(newExtractedData, fieldPath);
    
    // Try to get reasoning from the field object
    if (fieldObj && typeof fieldObj === 'object') {
      // Check for reasoning field directly
      if (fieldObj.reasoning) {
        if (Array.isArray(fieldObj.reasoning)) {
          return fieldObj.reasoning.join(' | ');
        }
        return String(fieldObj.reasoning);
      }
      
      // Check for verbatim field as fallback
      if (fieldObj.verbatim) {
        return String(fieldObj.verbatim);
      }
    }
    
    // Try to get reasoning from the parent field (if we have the .value path)
    if (fieldPath.endsWith('.value')) {
      const parentPath = fieldPath.slice(0, -6);
      const parentObj = this.getNestedValue(newExtractedData, parentPath);
      if (parentObj && typeof parentObj === 'object') {
        if (parentObj.reasoning) {
          if (Array.isArray(parentObj.reasoning)) {
            return parentObj.reasoning.join(' | ');
          }
          return String(parentObj.reasoning);
        }
        if (parentObj.verbatim) {
          return String(parentObj.verbatim);
        }
      }
    }
    
    return undefined;
  }
}
