import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  createUser,
  getAllUsers,
  editUser,
  disableUser,
  resetUserPassword,
} from "@/services/manage-user";



export const useCreateUser =
  () => {
    const queryClient =
      useQueryClient();

    return useMutation({
      mutationFn:
        createUser,

      onSuccess: () => {
        queryClient.invalidateQueries(
          {
            queryKey: [
              "users",
            ],
          }
        );
      },
    });
  };

export const useEditUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string, payload: Parameters<typeof editUser>[1] }) => editUser(userId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
};

export const useDisableUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disableUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
};

export const useResetUserPassword = () => {
  return useMutation({
    mutationFn: resetUserPassword,
  });
};

export const useUsers =
  () =>
    useQuery({
      queryKey: [
        "users",
      ],

      queryFn:
        getAllUsers,
    });