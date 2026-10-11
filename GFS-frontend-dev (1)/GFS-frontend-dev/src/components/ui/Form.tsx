// components/ui/FormComponents.tsx

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  FormWrapperProps,
  BaseFieldProps,
  InputFieldProps,
  CustomSelectProps,
  TextareaFieldProps,
  ButtonProps,
  SectionCardProps
} from "@/shared/types/form.types";


//  Main Form Wrapper
function Wrapper({
  children,
  onSubmit,
  className = "",
}: FormWrapperProps) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={className}
    >
      {children}
    </form>
  );
}

// Field Wrapper
function FieldWrapper({
  label,
  children,
  wrapperClassName = "",
  labelClassName = "",
}: BaseFieldProps) {
  return (
    <div className={wrapperClassName}>
      {label && (
        <label
          className={`block text-sm font-medium mb-1 ${labelClassName}`}
        >
          {label}
        </label>
      )}

      {children}
    </div>
  );
}


// Input Box
function Input({
  label,
  error,
  wrapperClassName,
  labelClassName,
  inputClassName = "",
  ...props
}: InputFieldProps) {
  return (
    <FieldWrapper
      label={label}
      wrapperClassName={wrapperClassName}
      labelClassName={labelClassName}
    >
      <input
        aria-label={label}
        {...props}
        className={`w-full rounded py-2 px-3 border transition ${inputClassName}`}
      />
    </FieldWrapper>
  );
}


//  Custom Dropdown Select
function CustomSelect({
  label,
  value,
  options,
  onChange,
  wrapperClassName = "",
  labelClassName = "",
  triggerClassName = "",
  dropdownClassName = "",
  optionClassName = "",
  placeholder = "Select Role",
}: CustomSelectProps) {
  const [open, setOpen] =
    useState(false);

  const selectedOption =
    options.find(
      (option) =>
        option.value === value
    );

  const handleSelect = (
    optionValue: string
  ) => {
    onChange({
      target: {
        value: optionValue,
      },
    });

    setOpen(false);
  };

  return (
    <div
      className={`relative ${wrapperClassName}`}
    >
      {/* LABEL */}
      {label && (
        <label
          className={`${labelClassName}`}
        >
          {label}
        </label>
      )}

      {/* TRIGGER */}
      <button
        type="button"
        onClick={() =>
          setOpen(!open)
        }
        className={`
          ${triggerClassName}
        `}
      >
        <span className="text-gray-500 ">
          {selectedOption
            ? selectedOption.label
            : placeholder}
        </span>

        <ChevronDown
          size={18}
          className={`transition-transform text-red-500 ${open
            ? "rotate-180"
            : ""
            }`}
        />
      </button>

      {/* DROPDOWN */}
      {open && (
        <div
          className={`
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
            ${dropdownClassName}
          `}
        >
          {options.map(
            (option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  handleSelect(
                    option.value
                  )
                }
                className={`
                  w-full
                  px-3
                  py-4
                  text-left
                  text-sm
                  transition
                  border-b
                  border-gray-200
                  ${value ===
                    option.value
                    ? "bg-red-50 text-red-500"
                    : "text-gray-700 hover:text-red-500"
                  }
                  ${optionClassName}
                `}
              >
                {option.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}


// Form Date
function DateField(
  props: InputFieldProps
) {
  return (
    <Input
      {...props}
      type="date"
    />
  );
}

// Form Textarea
function Textarea({
  label,
  wrapperClassName,
  labelClassName,
  textareaClassName = "",
  ...props
}: TextareaFieldProps) {
  return (
    <FieldWrapper
      label={label}
      wrapperClassName={wrapperClassName}
      labelClassName={labelClassName}
    >
      <textarea
        {...props}
        className={`w-full border rounded px-3 py-2 ${textareaClassName}`}
      />
    </FieldWrapper>
  );
}

// Form Button
function Button({
  disabled = false,
  text,
  type = "submit",
  className = "",
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`
        w-full text-white py-2 rounded transition
        ${disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:cursor-pointer"
        }
        ${className}
      `}
    >
      {text}
    </button>
  );
}


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



// Export as one form object
export const Form = {
  Wrapper,
  FieldWrapper,
  Input,
  CustomSelect,
  Date: DateField,
  Textarea,
  Button,
};