// components/auth/ProtectedRoute.tsx

import React from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/context/AuthContext";
import Splash from "@/components/ui/Splash";

type ProtectedRouteProps = {
  children: React.ReactNode;
};

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return <Splash />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
