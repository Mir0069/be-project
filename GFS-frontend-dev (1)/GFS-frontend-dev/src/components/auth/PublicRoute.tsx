// components/auth/PublicRoute.tsx

import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { getDashboardRoute } from "@/utils/authRedirect";
import Splash from "@/components/ui/Splash";

type PublicRouteProps = {
  children: React.ReactNode;
};

const PublicRoute = ({
  children,
}: PublicRouteProps) => {
  const {
    loading,
    isAuthenticated,
    role,
  } = useAuth();

  if (loading) {
    return <Splash />;
  }

  if (isAuthenticated) {
    return (
      <Navigate
        to={getDashboardRoute(role)}
        replace
      />
    );
  }

  return <>{children}</>;
};

export default PublicRoute;