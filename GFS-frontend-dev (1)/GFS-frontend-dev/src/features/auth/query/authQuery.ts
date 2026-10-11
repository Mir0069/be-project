// features/auth/query/authQuery.ts

import {
  useMutation,
  useQuery,
} from "@tanstack/react-query";

import {
  loginUser,
  logoutUser,
  registerUser,
  getCurrentUser,
  forgotPassword
} from "@/services/auth";

// Login
export const useLogin = () =>
  useMutation({
    mutationFn: loginUser,
  });

// Register
export const useRegister = () =>
  useMutation({
    mutationFn: registerUser,
  });

// Logout
export const useLogout = () =>
  useMutation({
    mutationFn: logoutUser,
  });

// Current User Logged In
export const useMe = () =>
  useQuery({
    queryKey: ["auth", "me"],
    queryFn: getCurrentUser,
    retry: false,
  });

// Forgot Password
export const useForgotPassword =
  () =>
    useMutation({
      mutationFn:
        forgotPassword,
    });
