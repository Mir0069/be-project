import { EventEmitter } from 'events';
import { StageDetailResponse, StageSaveResponse } from './proposal.types';

export const proposalEventBus = new EventEmitter();

// Define strongly typed event names
export enum ProposalEvent {
  STAGE_PUSHED = 'STAGE_PUSHED',
  STAGE_UPDATED = 'STAGE_UPDATED',
  STAGE_APPROVED = 'STAGE_APPROVED',
  STAGE_REOPENED = 'STAGE_REOPENED',
  STAGE_7_COST_UPDATED = 'STAGE_7_COST_UPDATED',
  STAGE_7_QUANTITY_UPDATED = 'STAGE_7_QUANTITY_UPDATED',
  STAGE_7_CHARGE_SELECTION_UPDATED = 'STAGE_7_CHARGE_SELECTION_UPDATED',
  STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED = 'STAGE_7_OPTIONAL_ADD_ON_STATUS_UPDATED',
}

export interface Stage7CostUpdatedPayload {
  projectId: string;
  data: {
    cell: string;
    new_cost: number;
    cost_overrides: Record<string, number>;
  };
}

export interface Stage7QuantityUpdatedPayload {
  projectId: string;
  data: {
    cell: string;
    new_quantity: number;
    quantity_overrides: Record<string, number>;
  };
}

export interface Stage7ChargeSelectionUpdatedPayload {
  projectId: string;
  data: {
    cell: string;
    selection: 'Y' | 'N';
    additional_charge_selections: Record<string, 'Y' | 'N'>;
  };
}

export interface Stage7OptionalAddOnStatusUpdatedPayload {
  projectId: string;
  data: {
    cell: string;
    status: 'NOT_SELECTED' | 'SELECTED_PENDING_ACCEPTANCE' | 'ACCEPTED' | 'DECLINED';
    optional_add_on_statuses: Record<string, string>;
    grand_total: number;
  };
}

// Typing definitions for listeners
export interface StagePushedPayload {
  projectId: string;
  data: StageSaveResponse;
}

export interface StageUpdatedPayload {
  projectId: string;
  data: StageDetailResponse;
}

export interface StageApprovedPayload {
  projectId: string;
  data: StageDetailResponse;
}
