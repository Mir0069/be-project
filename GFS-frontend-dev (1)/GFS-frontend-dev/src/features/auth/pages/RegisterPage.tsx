import React, { useState } from "react";
import { Form } from "@/components/ui/Form";
import { Mail, Lock, Eye, EyeOff, User } from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { showValidationToast } from "@/components/ui/validationtoast";
import { registerSchema } from "@/features/auth/validation/registerSchema";
import { useRegister } from "@/features/auth/query/authQuery";
import PasswordRequirements from "@/features/auth/components/PasswordRequirements";

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
];

const RegisterPage = () => {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "ESTIMATOR",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showPassword, setShowPassword] = useState(false);

  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const registerMutation = useRegister();

  // handling input change
  const handleChange = (
    e:
      | React.ChangeEvent<HTMLInputElement>
      | React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  };

  // form validation
  const validateForm = () => {
    const result = registerSchema.safeParse(formData);

    if (result.success) {
      return {};
    }

    const newErrors: Record<string, string> = {};

    result.error.issues.forEach((err) => {
      const field = err.path[0] as string;

      if (!newErrors[field]) {
        newErrors[field] = err.message;
      }
    });

    const allErrors = Object.values(newErrors).join(" | ");

    showValidationToast("error", allErrors, "register-error");

    return newErrors;
  };

  // handling form submit
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const validationErrors = validateForm();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});

    console.log(formData);
    registerMutation.mutate(
      {
        firstName: formData.firstName.trim(),

        lastName: formData.lastName.trim(),

        email: formData.email.trim(),

        password: formData.password,

        role: formData.role as "ESTIMATOR" | "SALES_MANAGER" | "SYSTEM_ADMIN",
      },

      {
        onSuccess: (response) => {
          showToast("success", "User registered successfully");

          /* Reset Form */
          setFormData({
            firstName: "",
            lastName: "",
            email: "",
            password: "",
            confirmPassword: "",
            role: "ESTIMATOR",
          });
        },
        onError: (error: any) => {
          const status = error?.status || error?.error?.statusCode;

          const backendMessage =
            error?.error?.message || error?.message || "Registration failed";

          if (status === 409) {
            showToast("error", "User with this email already exists");
            return;
          }

          if (status === 403) {
            showToast("error", "Only System Admin can register users");
            return;
          }

          showToast("error", backendMessage);
        },
      },
    );
  };

  return (
    <>
      <div className="border-l-3 border-red-500 px-4 space-y-1">
        <div className="text-2xl font-medium text-red-500">Register User</div>
      </div>

      {/* Register Form */}
      <div className="w-full  bg-[#E9EBF2] flex flex-col items-center justify-center mt-8">
        <div className="w-[56s0px] bg-white rounded-lg shadow-lg border border-gray-300 px-8 py-7">
          <Form.Wrapper onSubmit={handleSubmit} className="space-y-6">
            {/* Role Dropdown */}
            <div>
              <Form.CustomSelect
                label="Role"
                value={formData.role}
                options={ROLE_OPTIONS}
                onChange={(e: any) =>
                  setFormData((prev) => ({
                    ...prev,
                    role: e.target.value,
                  }))
                }
                labelClassName="block text-red-500 font-semibold mb-3"
                triggerClassName="w-full px-4 py-3 border border-gray-300 rounded-md text-sm text-left flex items-center justify-between
                                    bg-[#A6A5A5]/10 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                dropdownClassName="bg-white border-gray-300"
                optionClassName=""
                placeholder="Select Role"
              />
            </div>

            {/*  Entering First and Last Names */}
            <div>
              <label className="block text-red-500 font-semibold mb-3">
                Full Name
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <User
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-red-500"
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
                        ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                        : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                    }
                  />
                </div>

                <Form.Input
                  name="lastName"
                  type="text"
                  placeholder="Doe"
                  value={formData.lastName}
                  onChange={handleChange}
                  error={errors.lastName}
                  inputClassName={
                    errors.lastName
                      ? "pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                      : "pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                  }
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-red-500 font-semibold mb-3">
                Email Address
              </label>

              <div className="relative">
                <Mail
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-red-500"
                />

                <Form.Input
                  name="email"
                  type="email"
                  placeholder="name@companyname.com"
                  value={formData.email}
                  onChange={handleChange}
                  error={errors.email}
                  inputClassName={
                    errors.email
                      ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                      : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                  }
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-red-500 font-semibold mb-3">
                Password
              </label>

              <div className="relative">
                <Lock
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-red-500"
                />

                <Form.Input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••"
                  value={formData.password}
                  onChange={handleChange}
                  error={errors.password}
                  inputClassName={
                    errors.password
                      ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                      : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                  }
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <PasswordRequirements
                password={formData.password}
                email={formData.email}
                firstName={formData.firstName}
                lastName={formData.lastName}
              />
            </div>

            {/* Confirm Paasword */}
            <div>
              <label className="block text-red-500 font-semibold mb-3">
                Confirm Password
              </label>

              <div className="relative">
                <Lock
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-red-500"
                />

                <Form.Input
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="••••••••••"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  error={errors.confirmPassword}
                  inputClassName={
                    errors.confirmPassword
                      ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                      : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 rounded-md"
                  }
                />

                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* Register Button */}
            <Form.Button
              disabled={registerMutation.isPending}
              text={registerMutation.isPending ? "Registering..." : "Register"}
              className="mt-4 bg-red-500 hover:bg-red-700 py-2 font-semibold rounded-md"
            />
          </Form.Wrapper>
        </div>
      </div>
    </>
  );
};

export default RegisterPage;
