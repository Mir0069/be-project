import { useQuery } from "@tanstack/react-query";
import { getCallDirectory, getEstimatorDirectory } from "@/services/teams-call";

export const useCallDirectory = () =>
  useQuery({
    queryKey: ["teams-call", "directory"],
    queryFn: getCallDirectory,
    staleTime: 5 * 60 * 1000,
  });

// Estimators cannot list estimators, so the caller's role decides whether this runs.
export const useEstimatorDirectory = (enabled: boolean) =>
  useQuery({
    queryKey: ["teams-call", "estimators"],
    queryFn: getEstimatorDirectory,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
