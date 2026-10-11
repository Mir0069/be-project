import {
  useState,
} from "react";

import {
  ChevronDown,
} from "lucide-react";

interface FilterOption {
  label: string;
  value: string;
}

interface FilterDropdownProps {
  values: string[];
  onChange: (
    values: string[]
  ) => void;

  options: FilterOption[];

  placeholder?: string;

  className?: string;
}

const FilterDropdown = ({
  values,
  onChange,
  options,
  placeholder = "Filter",
  className = "",
}: FilterDropdownProps) => {

  const [
    open,
    setOpen,
  ] = useState(false);


  const handleToggle =
    (
      value: string
    ) => {

      if (
        values.includes(
          value
        )
      ) {

        onChange(
          values.filter(
            (item: any) =>
              item !==
              value
          )
        );

      } else {

        onChange([
          ...values,
          value,
        ]);

      }

    };


  return (

    <div
      className={`relative ${className}`}
    >

      {/* Trigger */}

      <button
        type="button"
        onClick={() =>
          setOpen(
            !open
          )
        }
        className="
        flex
        items-center
        justify-between
        gap-4
        px-4
        py-2
        border
        border-gray-300
        rounded-md
        bg-white
        min-w-[180px]
        text-sm
        hover:cursor-pointer
        "
      >

        <span className="text-gray-500">

          {
            values.length
              ? `${values.length} selected`
              : placeholder
          }

        </span>

        <ChevronDown
          size={18}
          className={`text-red-500 transition-transform ${open
            ? "rotate-180"
            : ""
            }`}
        />

      </button>



      {/* Dropdown */}

      {open && (

        <div
          className="
          absolute
          z-50
          mt-2
          w-full
          rounded-md
          border
          border-gray-300
          bg-white
          shadow-lg
          overflow-hidden
          "
        >

          {/* Header */}

          <div className="px-4 py-3 ">
            <p className="text-xs font-medium text-red-500 uppercase">
              Filter On
            </p>
          </div>



          {/* Options */}

          <div>
            {
              options.map(
                (
                  option
                ) => (

                  <label
                    key={
                      option.value
                    }
                    className="
                    flex
                    items-center
                    gap-3
                    px-4
                    py-3
                    cursor-pointer
                    hover:bg-red-50
                    border-b
                    border-gray-100
                    hover:cursor-pointer
                    "
                  >

                    <input
                      type="checkbox"
                      checked={
                        values.includes(
                          option.value
                        )
                      }
                      onChange={() =>
                        handleToggle(
                          option.value
                        )
                      }
                      className="
                      w-4
                      h-4
                      accent-red-500
                      "
                    />

                    <span className="text-sm text-gray-700">

                      {
                        option.label
                      }

                    </span>

                  </label>

                )
              )
            }

          </div>


          {/* Footer */}

          <div className="py-3 px-2 ">

            <button
              type="button"
              onClick={() =>
                onChange([])
              }
              className="
              text-xs
              px-2 py-1
              rounded-full
              text-red-500
              hover:text-red-600
              border-2
              font-medium
              hover:cursor-pointer
              "
            >
              Reset Filters
            </button>

          </div>

        </div>

      )}

    </div>

  );

};

export default FilterDropdown;