type SpecValueSelectProps = {
  value: unknown;
  options: readonly unknown[];
  formatOption: (value: unknown) => string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
};

/**
 * Select for a stage's single glass or frame value. A stored value that is not
 * an option (the AI's MANUAL) shows the placeholder instead of silently showing
 * the first option, which looked chosen but was never saved.
 */
export const SpecValueSelect = ({
  value,
  options,
  formatOption,
  placeholder,
  ariaLabel,
  onChange,
}: SpecValueSelectProps) => {
  const isOption = typeof value === "string" && options.includes(value);

  return (
    <select
      aria-label={ariaLabel}
      value={isOption ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      className="w-full border border-gray-300 rounded-md p-1.5 text-sm bg-white font-medium text-gray-800"
    >
      {!isOption && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {formatOption(option)}
        </option>
      ))}
    </select>
  );
};
