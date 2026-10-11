// features/auth/pages/LoginPage;

import React, { useEffect, useState } from "react";

import { Form } from "@/components/ui/Form";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { BsMicrosoft } from "react-icons/bs";

import { showToast } from "@/components/ui/toast";
import { showValidationToast } from "@/components/ui/validationtoast";
import { loginSchema } from "@/features/auth/validation/loginSchema";

import { useLogin } from "@/features/auth/query/authQuery";
import { getCurrentUser } from "@/services/auth";
import { queryClient } from "@/providers/QueryProvider";
// NEW: apiClient reused to build the backend OAuth redirect URL, and useSearchParams
// to read the ?oauth=... query param the backend sends us back with after the flow completes.
import { apiClient } from "@/shared/api/client";

import { useNavigate, useSearchParams } from "react-router-dom";
import { getDashboardRoute } from "@/utils/authRedirect";

const LoginPage = () => {
  const navigate = useNavigate();
  // NEW: reads ?oauth=success | failed | access_denied from the URL after the Microsoft
  // redirect flow completes (backend sets this on the /login redirect).
  const [searchParams, setSearchParams] = useSearchParams();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useLogin();

  // NEW: handle the result of the Microsoft OAuth redirect on page load.
  // The backend already set the auth cookies before redirecting here on success,
  // so on success we just need to fetch the current user and route them in.
  useEffect(() => {
    const oauthResult = searchParams.get("oauth");
    if (!oauthResult) return;

    const handleOAuthResult = async () => {
      if (oauthResult === "success") {
        try {
          const currentUser = await queryClient.fetchQuery({
            queryKey: ["auth", "me"],
            queryFn: getCurrentUser,
          });
          showToast("success", "Logged in successfully");
          navigate(getDashboardRoute((currentUser as any)?.role), { replace: true });
        } catch {
          showToast("error", "Could not complete Microsoft sign-in. Please try again.");
        }
      } else if (oauthResult === "access_denied") {
        showToast("error", "Microsoft sign-in was cancelled.");
      } else {
        // "failed" or any other unexpected value
        showToast("error", "Microsoft sign-in failed. Please try again.");
      }

      // Clean the ?oauth=... param out of the URL so a page refresh doesn't re-trigger this.
      searchParams.delete("oauth");
      setSearchParams(searchParams, { replace: true });
    };

    handleOAuthResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // NEW: kicks off the Microsoft login flow with a full page navigation
  // (must be a real browser redirect, not an axios/fetch call, since the
  // backend itself redirects to Microsoft's login page).
  const handleMicrosoftLogin = () => {
    const baseUrl = apiClient.defaults.baseURL?.replace(/\/$/, "") ?? "";
    window.location.href = `${baseUrl}/auth/oauth/microsoft`;
  };

  // handling the input
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    /* Clear field-specific error */
    setErrors((prev) => ({
      ...prev,
      [name]: "",
    }));
  };

  // form validation
  const validateForm = () => {
    const result = loginSchema.safeParse(formData);

    if (result.success) {
      return {};
    }

    const newErrors: Record<string, string> = {};

    result.error.issues.forEach((err) => {
      const field = err.path[0] as string;

      /* Only first error per field */
      if (!newErrors[field]) {
        newErrors[field] = err.message;
      }
    });

    const allErrors = Object.values(newErrors).join(" | ");

    showValidationToast("error", allErrors, "login-error");

    return newErrors;
  };

  // submit function
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const validationErrors = validateForm();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});

    loginMutation.mutate(
      {
        email: formData.email.trim(),
        password: formData.password,
      },
      {
        //  Success
        onSuccess: async (response: any) => {
          showToast("success", response?.message || "Logged in successfully");

          const user = response?.user || response?.data?.user;
          const token = response?.accessToken || response?.data?.accessToken;
          if (token) {
            localStorage.setItem("accessToken", token);
          }

          // The login response contains the same safe user profile as
          // /auth/me. Seed the cache directly so successful login needs no
          // second round trip before role-based navigation.
          let currentUser = user;
          if (currentUser) {
            queryClient.setQueryData(["auth", "me"], currentUser);
          } else {
            // Keep rolling deployments compatible: if an older backend returns
            // the previous message-only response, resolve the user the old way.
            try {
              currentUser = await queryClient.fetchQuery({
                queryKey: ["auth", "me"],
                queryFn: getCurrentUser,
              });
            } catch (err) {
              console.error("Failed to fetch /auth/me after login:", err);
              navigate("/estimator/projects", { replace: true });
              return;
            }
          }

          if (!currentUser) {
            showToast("error", "Could not load your account. Please try again.");
            return;
          }

          navigate(getDashboardRoute(currentUser.role), { replace: true });
        },

        //  Error
        onError: (error: any) => {
          console.log(error);

          const message = error?.message || "Login failed";

          const status = error?.status || error?.error?.statusCode;

          if (status === 401) {
            showToast("error", "Invalid email or password");
            return;
          }

          if (message === "Please login with your OAuth provider") {
            showToast("error", "This account uses Microsoft login.");
            return;
          }

          // Fallback Error Toast
          showToast("error", message);
        },
      },
    );
  };

  return (
    <div className="py-8 w-full min-h-screen bg-[#E9EBF2] rounded-md shadow-2xl flex flex-col items-center justify-center">
      <div className="w-full flex flex-col items-center mb-6">
        <img src="/gfs.png" alt="smartmfgai-logo" className="w-35" />
        <p className="mt-4 text-gray-700 font-normal text-sm">
          Sign in to your account.
        </p>
      </div>

      <div className="w-[420px] flex items-center justify-center bg-white rounded-lg shadow-lg border-2 border-gray-400/40 px-6 py-8 ">
        <Form.Wrapper onSubmit={handleSubmit} className="w-full space-y-6">
          {/* Email Input */}
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
                placeholder="name@glassflooringsystem.com"
                value={formData.email}
                onChange={handleChange}
                error={errors.email}
                inputClassName={
                  errors.email
                    ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                    : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 rounded-md"
                }
              />
            </div>
          </div>

          {/* Password Input */}
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
                placeholder="••••••••••••••"
                value={formData.password}
                onChange={handleChange}
                error={errors.password}
                inputClassName={
                  errors.password
                    ? "pl-10 pr-4 bg-[#A6A5A5]/10 border-red-500 border-2 outline-none focus:outline-none rounded-md"
                    : "pl-10 pr-4 bg-[#A6A5A5]/10 border-gray-300 outline-none focus:outline-none focus:ring-1 focus:ring-red-500 rounded-md"
                }
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500 hover:cursor-pointer"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Sign In Button */}
          <Form.Button
            disabled={loginMutation.isPending}
            text={loginMutation.isPending ? "Signing In..." : "Sign In"}
            className="mt-3 bg-red-500 hover:bg-red-700 py-2 font-semibold rounded-md outline-none"
          />

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-red-500 text-md">or</span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          {/* Google Oauth Button */}
          {/* <button
            type="button"
            className="w-full border-2 border-gray-300/40 rounded-md py-2 font-medium flex items-center justify-center gap-2 hover:cursor-pointer hover:border-2 hover:border-red-500 transition"
          >
            <FcGoogle size={20} />
            <div>Continue with Google</div>
          </button> */}

          {/* Microsoft Oauth Button */}
          {/* CHANGED: added onClick to actually kick off the Microsoft OAuth redirect flow */}
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            className="w-full border-2 border-gray-300/40 rounded-md py-2 font-medium flex items-center justify-center gap-2 hover:cursor-pointer hover:border-2 hover:border-red-500 transition"
          >
            <BsMicrosoft size={16} className="text-[#09A7F0]" />
            <div>Continue with Microsoft</div>
          </button>
        </Form.Wrapper>
      </div>

      {/* Forgot Password Redirect */}
      <p className="text-center text-md text-gray-700 mt-8">
        Forgot Password.{" "}
        {/* <span className="text-red-500 hover:underline hover:cursor-pointer">Need Help?</span> */}
        <span
          onClick={() => navigate("/forgot-password")}
          className="text-red-500 hover:underline hover:cursor-pointer"
        >
          Need Help?
        </span>
      </p>
    </div>
  );
};

export default LoginPage;
