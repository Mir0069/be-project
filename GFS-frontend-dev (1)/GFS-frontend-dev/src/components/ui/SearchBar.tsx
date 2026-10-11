import { Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

const SearchBar = ({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
  inputClassName = "",
}: SearchBarProps) => {
  return (
    <div
      className={`relative w-[300px] ${className}`}
    >
      <Search
        size={18}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
      />

      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e: any) =>
          onChange(e.target.value)
        }
        className={`
          w-full
          pl-10
          pr-4
          py-2
          rounded-md
          text-sm
          bg-white
          focus:outline-none
          ${inputClassName || "border border-gray-300 focus:border-red-500"}
        `}
      />
    </div>
  );
};

export default SearchBar;
