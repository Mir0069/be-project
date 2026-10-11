// components/auth/RoleGuard.tsx

import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/shared/types/auth.types";
import { hasAnyRole } from "@/shared/lib/roleAccess";
import { getDashboardRoute } from "@/utils/authRedirect";
import Splash from "@/components/ui/Splash";

type RoleGuardProps = {
  children: React.ReactNode;

  allowedRoles: UserRole[];
};

const RoleGuard = ({
  children,
  allowedRoles,
}: RoleGuardProps) => {
  const {
    loading,
    user,
  } = useAuth();


  if (loading) {
    return <Splash />;
  }

  // If unauthenticated
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
      />
    );
  }

  // If unauthorized
  if (
    !hasAnyRole(user.role, allowedRoles)
  ) {
    return (
      <Navigate
        to={getDashboardRoute(
          user.role
        )}
        replace
      />
    );
  }
  
  return <>{children}</>;
};

export default RoleGuard;