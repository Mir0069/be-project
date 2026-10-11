// pages/estimator/workspace/components/ParamSelect.tsx

import { ChevronDown } from "lucide-react";

type Props = {
  value: string;
  options: string[];
  onChange: (val: string) => void;
  placeholder?: string;
  ariaLabel: string;
};

const ParamSelect = ({ value, options, onChange, placeholder, ariaLabel }: Props) => {
  return (
    <div className="relative">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        className="w-full appearance-none bg-white border border-gray-200 rounded-md px-3 py-2 pr-9 text-sm text-gray-700 outline-none focus:border-red-500 transition"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
    </div>
  );
};

export default ParamSelect;
