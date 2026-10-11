/* eslint-disable react-refresh/only-export-components */
// components/context/AuthContext.tsx

import React, { createContext, useContext, useMemo } from "react";

import { useMe } from "@/features/auth/query/authQuery";

import type { AuthUser, UserRole } from "@/shared/types/auth.types";

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  isAuthenticated: boolean;

  role: UserRole | null;

  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  isSalesManager: boolean;
  isEstimator: boolean;
  isHeadOfDivision: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

// Auth Context Provider
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: user, isLoading } = useMe();

  const loading = isLoading;

  const value = useMemo<AuthContextType>(() => {
    const role = user?.role ?? null;

    return {
      user: user ?? null,
      loading,
      isAuthenticated: !!user,
      role,
      isSuperAdmin: role === "SUPER_ADMIN",
      isSystemAdmin: role === "SYSTEM_ADMIN",
      isSalesManager: role === "SALES_MANAGER",
      isEstimator: role === "ESTIMATOR",
      isHeadOfDivision: role === "HEAD_OF_DIVISION",
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

//  Custom Hook to access current user logged in
export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
};
