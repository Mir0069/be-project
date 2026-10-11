import { useState } from "react";

import { Link } from "react-router-dom";

import { Mail } from "lucide-react";

import { Form } from "@/components/ui/Form";

import { showToast } from "@/components/ui/toast";

import { showValidationToast } from "@/components/ui/validationtoast";

import { useForgotPassword } from "@/features/auth/query/authQuery";

const ForgotPasswordPage = () => {
  const forgotPasswordMutation = useForgotPassword();

  const [email, setEmail] = useState("");

  const [error, setError] = useState("");

  const [requestSent, setRequestSent] = useState(false);

  const validateEmail = () => {
    if (!email.trim()) {
      setError("Email is required");

      showValidationToast(
        "error",
        "Email is required",
        "forgot-password-error",
      );

      return false;
    }

    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateEmail()) {
      return;
    }

    forgotPasswordMutation.mutate(
      {
        email: email.trim(),
      },

      {
        onSuccess: () => {
          setRequestSent(true);
          showToast("success", "Password reset link has been sent to your email.");
        },

        onError: (error: any) => {
          setRequestSent(false);
          showToast("error", error?.message || "Failed to send reset link");
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-[#E9EBF2] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-red-500">
            Forgot Password
          </h1>

          <p className="text-sm text-gray-500 mt-2">
            Enter your email address and we will send you a reset link.
          </p>
        </div>

        <Form.Wrapper onSubmit={handleSubmit} className="space-y-6">
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
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e: any) => {
                  setEmail(e.target.value);

                  setError("");

                  setRequestSent(false);
                }}
                error={error}
                inputClassName="pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 rounded-md"
              />
            </div>
          </div>

          <Form.Button
            disabled={forgotPasswordMutation.isPending}
            text={
              forgotPasswordMutation.isPending
                ? "Sending..."
                : "Send Reset Link"
            }
            className="bg-red-500 hover:bg-red-700 py-2 font-semibold rounded-md"
          />
        </Form.Wrapper>

        {requestSent && (
          <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
            <p className="text-sm font-medium text-emerald-800">
              Password reset link has been sent to your email.
            </p>
            <Link
              to="/login"
              className="mt-2 inline-flex text-sm font-semibold text-red-500 transition hover:text-red-700 hover:underline"
            >
              Go to login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
