// shared/types/form.types.ts

import type { ReactNode } from "react";
import type React from "react";

//  Select Option Type
export interface SelectOption {
  label: string;
  value: string;
}


//  Form Wrapper Type
export interface FormWrapperProps {
  children: React.ReactNode;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  className?: string;
}


//  Base Field Wrapper Type
export interface BaseFieldProps {
  label?: string;
  error?: string;
  children: React.ReactNode;

  /* Wrapper Styling */
  wrapperClassName?: string;

  /* Label Styling */
  labelClassName?: string;

  /* Error Styling */
  errorClassName?: string;
}

//  Input Field Type
export interface InputFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;

  /* Wrapper Styling */
  wrapperClassName?: string;

  /* Label Styling */
  labelClassName?: string;

  /* Error Styling */
  errorClassName?: string;

  /* Input Styling */
  inputClassName?: string;
}


//  Select Field Type
export interface SelectFieldProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;

  options: SelectOption[];

  /* Wrapper Styling */
  wrapperClassName?: string;

  /* Label Styling */
  labelClassName?: string;

  /* Error Styling */
  errorClassName?: string;

  /* Select Styling */
  selectClassName?: string;
}


//  Textarea Field Type
export interface TextareaFieldProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;

  /* Wrapper Styling */
  wrapperClassName?: string;

  /* Label Styling */
  labelClassName?: string;

  /* Error Styling */
  errorClassName?: string;

  /* Textarea Styling */
  textareaClassName?: string;
}

// Button Props Type
export interface ButtonProps {
  disabled: boolean;

  text: string;

  type?: "button" | "submit" | "reset";

  className?: string;

  onClick?: (
    e: React.MouseEvent<HTMLButtonElement>
  ) => void;
}

export interface SectionCardProps {
  title: string;
  icon?: ReactNode;
  required?: boolean;
  children: ReactNode;
};

//  Custom Selection Types
type CustomSelectOption = {
  label: string;
  value: string;
};



export interface CustomSelectProps  {
  label?: string;

  value: string;

  options: CustomSelectOption[];

  onChange: (e: {
    target: {
      value: string;
    };
  }) => void;

  wrapperClassName?: string;

  labelClassName?: string;

  triggerClassName?: string;

  dropdownClassName?: string;

  optionClassName?: string;

  placeholder?: string;
};


