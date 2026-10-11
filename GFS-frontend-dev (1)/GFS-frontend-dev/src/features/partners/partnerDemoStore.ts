import { useSyncExternalStore } from "react";

// Temporary browser-backed repository for the partner demo. Keeping storage
// access here makes it straightforward to replace with Partner API queries later.

export type PartnerStatus = "ACTIVE" | "INACTIVE";

export type DemoPartner = {
  id: string;
  partnerNumber: string;
  name: string;
  territory: string;
  address: string;
  status: PartnerStatus;
  createdAt: string;
  updatedAt: string;
};

export type PartnerAssignment = {
  draftId: string;
  partnerId: string;
  projectId?: string;
  assignedAt: string;
};

type PartnerDemoState = {
  version: 1;
  partners: DemoPartner[];
  assignments: PartnerAssignment[];
};

export type PartnerInput = Pick<DemoPartner, "name" | "territory" | "address">;

const STORAGE_KEY = "gfs.partner-demo.v1";
const EMPTY_STATE: PartnerDemoState = { version: 1, partners: [], assignments: [] };
const listeners = new Set<() => void>();

const readState = (): PartnerDemoState => {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<PartnerDemoState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.partners) || !Array.isArray(parsed.assignments)) {
      return EMPTY_STATE;
    }
    return parsed as PartnerDemoState;
  } catch {
    return EMPTY_STATE;
  }
};

let snapshot = readState();

const emit = () => listeners.forEach((listener) => listener());

const persist = (next: PartnerDemoState) => {
  snapshot = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  emit();
};

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `partner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const nextPartnerNumber = (partners: DemoPartner[]) => {
  const highest = partners.reduce((current, partner) => {
    const value = Number(partner.partnerNumber.match(/(\d+)$/)?.[1] ?? 0);
    return Math.max(current, value);
  }, 1000);
  return `PTR-${String(highest + 1).padStart(4, "0")}`;
};

export const subscribePartnerDemoStore = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getPartnerDemoSnapshot = () => snapshot;

export const usePartnerDemoStore = () =>
  useSyncExternalStore(subscribePartnerDemoStore, getPartnerDemoSnapshot, getPartnerDemoSnapshot);

export const createDemoPartner = (input: PartnerInput): DemoPartner => {
  const now = new Date().toISOString();
  const partner: DemoPartner = {
    id: newId(),
    partnerNumber: nextPartnerNumber(snapshot.partners),
    name: input.name.trim(),
    territory: input.territory.trim(),
    address: input.address.trim(),
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  persist({ ...snapshot, partners: [...snapshot.partners, partner] });
  return partner;
};

export const updateDemoPartner = (partnerId: string, input: PartnerInput) => {
  const now = new Date().toISOString();
  persist({
    ...snapshot,
    partners: snapshot.partners.map((partner) =>
      partner.id === partnerId
        ? {
            ...partner,
            name: input.name.trim(),
            territory: input.territory.trim(),
            address: input.address.trim(),
            updatedAt: now,
          }
        : partner,
    ),
  });
};

export const setDemoPartnerStatus = (partnerId: string, status: PartnerStatus) => {
  persist({
    ...snapshot,
    partners: snapshot.partners.map((partner) =>
      partner.id === partnerId
        ? { ...partner, status, updatedAt: new Date().toISOString() }
        : partner,
    ),
  });
};

export const assignDemoPartnerToDraft = (draftId: string, partnerId: string) => {
  const assignment: PartnerAssignment = {
    draftId,
    partnerId,
    assignedAt: new Date().toISOString(),
  };
  persist({
    ...snapshot,
    assignments: [
      ...snapshot.assignments.filter((item) => item.draftId !== draftId),
      assignment,
    ],
  });
};

export const promoteDemoPartnerAssignment = (draftId: string, projectId: string) => {
  persist({
    ...snapshot,
    assignments: snapshot.assignments.map((assignment) =>
      assignment.draftId === draftId ? { ...assignment, projectId } : assignment,
    ),
  });
};

export const getPartnerForDraft = (state: PartnerDemoState, draftId: string) => {
  const assignment = state.assignments.find((item) => item.draftId === draftId);
  return state.partners.find((partner) => partner.id === assignment?.partnerId) ?? null;
};

export const getPartnerForProject = (state: PartnerDemoState, projectId: string) => {
  const assignment = state.assignments.find((item) => item.projectId === projectId);
  return state.partners.find((partner) => partner.id === assignment?.partnerId) ?? null;
};

export const resetPartnerDemoStore = () => {
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  snapshot = EMPTY_STATE;
  emit();
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = readState();
    emit();
  });
}
