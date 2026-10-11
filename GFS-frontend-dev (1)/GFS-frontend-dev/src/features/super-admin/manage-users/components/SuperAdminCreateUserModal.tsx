import React, { useState } from "react";
import {
  User,
  Mail,
  X,
} from "lucide-react";

import { Form } from "@/components/ui/Form";
import { showToast } from "@/components/ui/toast";
import { showValidationToast } from "@/components/ui/validationtoast";

import { createUserSchema } from "@/features/system-admin/manage-users/createUserSchema";
import { useCreateUser } from "@/features/system-admin/manage-users/query/manage-user.query";
import { getUserManagementErrorMessage } from "@/features/system-admin/manage-users/utils";

import type { CreateUserPayload } from "@/services/manage-user";

const ROLE_OPTIONS = [
  {
    label: "Estimator",
    value: "ESTIMATOR",
  },
  {
    label: "Sales Manager",
    value: "SALES_MANAGER",
  },
  {
    label: "System Admin",
    value: "SYSTEM_ADMIN",
  },
  {
    label: "Super Admin",
    value: "SUPER_ADMIN",
  },
  {
    label: "Head of Division",
    value: "HEAD_OF_DIVISION",
  },
];

interface Props {
  onClose: () => void;
}

const SuperAdminCreateUserModal = ({
  onClose,
}: Props) => {

  const createUserMutation =
    useCreateUser();

  const [formData, setFormData] =
    useState<CreateUserPayload>({
      firstName: "",
      lastName: "",
      email: "",
      role: "ESTIMATOR",
    });

  const [errors, setErrors] =
    useState<Record<string, string>>(
      {}
    );


  const handleChange = (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLSelectElement>
  ) => {

    const { name, value } =
      e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  };


  const validateForm = () => {

    const result =
      createUserSchema.safeParse(
        formData
      );

    if (result.success) {
      return {};
    }

    const newErrors:
      Record<string, string> =
      {};

    result.error.issues.forEach(
      (err) => {

        const field =
          err.path[0] as string;

        if (
          !newErrors[field]
        ) {
          newErrors[field] =
            err.message;
        }

      }
    );

    showValidationToast(
      "error",
      Object.values(
        newErrors
      ).join(" | "),
      "user-create-error"
    );

    return newErrors;
  };


  const handleSubmit = (
    e: React.FormEvent
  ) => {

    e.preventDefault();

    const validationErrors =
      validateForm();

    if (
      Object.keys(
        validationErrors
      ).length > 0
    ) {

      setErrors(
        validationErrors
      );

      return;
    }

    createUserMutation.mutate(
      formData,
      {

        onSuccess: () => {

          showToast(
            "success",
            "User created successfully. An email was sent to set the password."
          );

          onClose();

        },

        onError: (error: unknown) => {

          showToast(
            "error",
            getUserManagementErrorMessage(error, "Failed creating user")
          );

        },

      }
    );

  };


  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">

      <div className="bg-white w-[500px] rounded-lg shadow-xl px-6 py-7 relative">

        <div className="flex justify-between">
          <div className="mb-2">
            <div className="text-xl font-semibold text-red-500">
              Create User
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Enter required user details to create an user.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-5 right-5 w-7 h-7 flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 hover:cursor-pointer transition"
          >
            <X size={16} />
          </button>

        </div>


        <Form.Wrapper
          onSubmit={
            handleSubmit
          }
          className="space-y-6 mt-4"
        >

          <Form.CustomSelect
            label="Role"
            value={
              formData.role
            }
            options={
              ROLE_OPTIONS
            }
            onChange={(e: any) =>
              setFormData(
                (prev) => ({
                  ...prev,

                  role:
                    e.target
                      .value as
                    CreateUserPayload["role"],
                })
              )
            }
            labelClassName="block text-red-500 font-semibold mb-2 text-sm"
            triggerClassName="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-md text-left flex items-center justify-between
                                    bg-[#A6A5A5]/10 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            dropdownClassName="bg-white border-gray-300"
            optionClassName=""
            placeholder="Select Role"
          />

          <div className="grid grid-cols-2 gap-4">

            <div className="flex flex-col w-full">
              <label className="text-red-500 font-medium mb-2 text-sm">
                First Name
              </label>

              <div className="relative w-full">
                <User
                  size={18}
                  className="absolute left-3 top-2.5 text-red-500"
                />

                <Form.Input
                  name="firstName"
                  type="text"
                  placeholder="John"
                  value={formData.firstName}
                  onChange={handleChange}
                  error={errors.firstName}
                  inputClassName={
                    errors.firstName
                      ? "w-full pl-10 pr-4 py-1 text-sm bg-[#A6A5A5]/10 border-red-500 border-2 outline-none rounded-md"
                      : "w-full pl-10 pr-4 py-1 text-sm bg-[#A6A5A5]/10 border-gray-300 outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                  }
                />
              </div>
            </div>

            <div className="flex flex-col w-full">
              <label className="text-red-500 font-medium mb-2 text-sm">
                Last Name
              </label>

              <Form.Input
                name="lastName"
                type="text"
                placeholder="Doe"
                value={formData.lastName}
                onChange={handleChange}
                error={errors.lastName}
                inputClassName={
                  errors.lastName
                    ? "w-full pr-4 py-1 text-sm bg-[#A6A5A5]/10 border-red-500 border-2 outline-none rounded-md"
                    : "w-full pr-4 py-1 text-sm bg-[#A6A5A5]/10 border-gray-300 outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                }
              />
            </div>

          </div>

          {/* Email */}
          <div>
            <label className="block text-red-500 font-semibold mb-2 text-sm">
              Email Address
            </label>

            <div className="relative">
              <Mail
                size={18}
                className="absolute left-3 top-5 -translate-y-1/2 text-red-500"
              />

              <Form.Input
                name="email"
                type="email"
                placeholder="name@companyname.com"
                value={
                  formData.email
                }
                onChange={
                  handleChange
                }
                error={
                  errors.email
                }
                inputClassName={
                  errors.email
                    ? "pl-10 pr-4 py-1 text-sm bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                    : "pl-10 pr-4 py-1 text-sm bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                }
              />
            </div>
          </div>

          {/* <div className="flex justify-end gap-3 mt-8"> */}

          {/* Register Button */}
          <Form.Button
            disabled={
              createUserMutation.isPending
            }
            text={
              createUserMutation.isPending
                ? "Creating..."
                : "Create User"
            }
            className="mt-4 bg-red-500 hover:bg-red-700 py-2 font-semibold rounded-md"
          />

          {/* </div> */}

        </Form.Wrapper>

      </div>

    </div>
  );
};

export default SuperAdminCreateUserModal;
