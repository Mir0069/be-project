// pages/sales-manager/form/FormPrimitives.tsx
// Shared form primitives used by CreateProject and ZohoLeadDetail
// so both pages stay visually identical.

import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:border-red-500 focus:bg-white transition";

type SectionCardProps = {
  title: string;
  icon?: ReactNode;
  required?: boolean;
  children: ReactNode;
};

export const SectionCard = ({
  title,
  icon,
  required,
  children,
}: SectionCardProps) => (
  <section className="bg-white rounded-lg border border-gray-200 p-5">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
        {icon && <span className="text-red-500">{icon}</span>}
        {title}
      </h3>
      {required && (
        <span className="text-xs text-red-500 font-medium">*Required</span>
      )}
    </div>
    {children}
  </section>
);

type FieldProps = {
  label: string;
  children: ReactNode;
};

export const Field = ({ label, children }: FieldProps) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1.5">
      {label}
    </label>
    {children}
  </div>
);