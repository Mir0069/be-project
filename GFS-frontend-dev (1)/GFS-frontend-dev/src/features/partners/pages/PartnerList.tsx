import { useMemo, useState } from "react";
import { Handshake, Pencil, Plus, Search, X } from "lucide-react";

import { showToast } from "@/components/ui/toast";
import {
  createDemoPartner,
  setDemoPartnerStatus,
  updateDemoPartner,
  usePartnerDemoStore,
  type DemoPartner,
  type PartnerInput,
} from "../partnerDemoStore";

const EMPTY_FORM: PartnerInput = { name: "", territory: "", address: "" };

const PartnerList = () => {
  const state = usePartnerDemoStore();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DemoPartner | null | undefined>(undefined);
  const [form, setForm] = useState<PartnerInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof PartnerInput, string>>>({});

  const partners = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...state.partners]
      .filter((partner) =>
        !term
          ? true
          : [partner.name, partner.partnerNumber, partner.territory, partner.address, partner.status]
              .join(" ")
              .toLowerCase()
              .includes(term),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [search, state.partners]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const openEdit = (partner: DemoPartner) => {
    setEditing(partner);
    setForm({ name: partner.name, territory: partner.territory, address: partner.address });
    setErrors({});
  };

  const closeForm = () => setEditing(undefined);

  const handleSubmit = () => {
    const nextErrors: Partial<Record<keyof PartnerInput, string>> = {};
    if (!form.name.trim()) nextErrors.name = "Partner name is required.";
    if (!form.territory.trim()) nextErrors.territory = "Service region is required.";
    const duplicate = state.partners.some(
      (partner) =>
        partner.id !== editing?.id &&
        partner.name.trim().toLowerCase() === form.name.trim().toLowerCase() &&
        partner.territory.trim().toLowerCase() === form.territory.trim().toLowerCase(),
    );
    if (duplicate) nextErrors.name = "This partner already exists in the selected service region.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    if (editing) {
      updateDemoPartner(editing.id, form);
      showToast("success", "Partner updated successfully.");
    } else {
      createDemoPartner(form);
      showToast("success", "Partner added successfully.");
    }
    closeForm();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="border-l-3 border-red-500 px-4">
          <h1 className="text-2xl font-medium leading-[1.9rem] text-red-500">Partner List</h1>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          <Plus size={16} /> Add Partner
        </button>
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search partner, service region or number"
          aria-label="Search partner list"
          className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15"
        />
      </div>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Partner</th>
                <th className="px-5 py-3 font-semibold">Service Region</th>
                <th className="px-5 py-3 font-semibold">Address</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {partners.length ? (
                partners.map((partner) => (
                  <tr key={partner.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{partner.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{partner.partnerNumber}</p>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{partner.territory}</td>
                    <td className="max-w-[280px] px-5 py-4 text-gray-700">{partner.address || "-"}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${partner.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {partner.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(partner)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-red-500 hover:text-red-600"
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextStatus = partner.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
                            setDemoPartnerStatus(partner.id, nextStatus);
                            showToast("success", `Partner marked ${nextStatus === "ACTIVE" ? "active" : "inactive"}.`);
                          }}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-red-500 hover:text-red-600"
                        >
                          {partner.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-14 text-center">
                    <Handshake size={28} className="mx-auto text-gray-300" />
                    <p className="mt-3 text-sm font-medium text-gray-700">{search ? "No partners match your search." : "No partners have been added."}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing !== undefined ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="partner-form-title" className="relative w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 shadow-xl">
            <button type="button" onClick={closeForm} aria-label="Close" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100">
              <X size={18} />
            </button>
            <h2 id="partner-form-title" className="text-lg font-semibold text-gray-900">{editing ? "Edit Partner" : "Add Partner"}</h2>
            <div className="mt-5 space-y-4">
              {([
                ["name", "Partner Name", "Enter partner name"],
                ["territory", "Service Region", "Enter service region"],
                ["address", "Address", "Enter business address"],
              ] as const).map(([field, label, placeholder]) => (
                <label key={field} className="block text-sm font-medium text-gray-700">
                  {label}{field !== "address" ? " *" : ""}
                  <input
                    value={form[field]}
                    onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                    placeholder={placeholder}
                    className={`mt-1.5 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500/15 ${errors[field] ? "border-red-500" : "border-gray-300 focus:border-red-500"}`}
                  />
                  {errors[field] ? <span className="mt-1 block text-xs text-red-600">{errors[field]}</span> : null}
                </label>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-200 pt-4">
              <button type="button" onClick={closeForm} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400">Cancel</button>
              <button type="button" onClick={handleSubmit} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">{editing ? "Save Changes" : "Add Partner"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PartnerList;
