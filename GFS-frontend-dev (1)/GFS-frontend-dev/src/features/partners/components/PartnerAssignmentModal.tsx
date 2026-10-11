import { useMemo, useState } from "react";
import { Check, Handshake, Search, X } from "lucide-react";

import {
  assignDemoPartnerToDraft,
  getPartnerForDraft,
  usePartnerDemoStore,
} from "../partnerDemoStore";

type Props = {
  open: boolean;
  draftId: string | null;
  projectName: string;
  onClose: () => void;
  onAssigned: (partnerName: string) => void;
};

const PartnerAssignmentModal = ({ open, draftId, projectName, onClose, onAssigned }: Props) => {
  const state = usePartnerDemoStore();
  const [search, setSearch] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState(
    draftId ? getPartnerForDraft(state, draftId)?.id ?? "" : "",
  );

  const partners = useMemo(() => {
    const term = search.trim().toLowerCase();
    return state.partners
      .filter((partner) => partner.status === "ACTIVE")
      .filter((partner) =>
        !term
          ? true
          : [partner.name, partner.partnerNumber, partner.territory, partner.address]
              .join(" ")
              .toLowerCase()
              .includes(term),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [search, state.partners]);

  if (!open || !draftId) return null;

  const handleAssign = () => {
    const partner = state.partners.find((item) => item.id === selectedPartnerId);
    if (!partner) return;
    assignDemoPartnerToDraft(draftId, partner.id);
    onAssigned(partner.name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="partner-assignment-title"
        className="relative flex max-h-[86vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        >
          <X size={18} />
        </button>

        <div className="pr-9">
          <h3 id="partner-assignment-title" className="text-lg font-semibold text-gray-900">
            Assign Partner
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Select the partner that introduced {projectName || "this project"}.
          </p>
        </div>

        <div className="relative mt-5">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search partner, service region or number"
            aria-label="Search partners"
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-800 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
          />
        </div>

        <div role="listbox" aria-label="Active partners" className="mt-4 min-h-0 overflow-y-auto rounded-md border border-gray-200">
          {partners.length ? (
            partners.map((partner) => {
              const selected = partner.id === selectedPartnerId;
              return (
                <button
                  key={partner.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setSelectedPartnerId(partner.id)}
                  className={`flex w-full items-start gap-3 border-b border-gray-100 px-3 py-3 text-left last:border-b-0 ${selected ? "bg-red-50" : "hover:bg-gray-50"}`}
                >
                  <Handshake size={17} className={`mt-0.5 shrink-0 ${selected ? "text-red-600" : "text-gray-400"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">{partner.name}</span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {partner.partnerNumber} | {partner.territory}
                    </span>
                    {partner.address ? <span className="mt-0.5 block truncate text-xs text-gray-500">{partner.address}</span> : null}
                  </span>
                  {selected ? <Check size={16} className="mt-0.5 shrink-0 text-red-600" /> : null}
                </button>
              );
            })
          ) : (
            <p className="px-4 py-10 text-center text-sm text-gray-500">
              {search ? "No active partners match your search." : "No active partners are available. Add one from Partner List."}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-gray-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={!selectedPartnerId}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Handshake size={15} /> Assign Partner
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartnerAssignmentModal;
