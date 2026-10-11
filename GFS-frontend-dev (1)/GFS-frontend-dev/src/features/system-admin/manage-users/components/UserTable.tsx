// import {
//   useMemo,
//   useState,
// } from "react";

// import {
//   User,
//   Mail,
//   Plus,
// } from "lucide-react";

// import { useUsers } from "../query/manage-user.query";

// import SearchBar from "@/components/ui/SearchBar";
// import FilterDropdown from "@/components/ui/Filter";
// import CreateUserModal from "./CreateUserModal";

// const ROLE_OPTIONS = [
//   {
//     label: "Estimator",
//     value: "ESTIMATOR",
//   },
//   {
//     label: "Sales Manager",
//     value: "SALES_MANAGER",
//   },
// ];



// const UserTable = () => {

//   const {
//     data: users = [],
//     isLoading,
//     isError,
//   } = useUsers();

//   const [
//     searchTerm,
//     setSearchTerm,
//   ] = useState("");

//   const [
//     selectedRole,
//     setSelectedRole,
//   ] = useState<string[]>(
//     []
//   );


//   const filteredUsers =
//     useMemo(() => {

//       return users.filter(
//         (user) => {

//           const search =
//             searchTerm.toLowerCase();

//           const matchesSearch =

//             user.firstName
//               .toLowerCase()
//               .includes(
//                 search
//               )

//             ||

//             user.lastName
//               .toLowerCase()
//               .includes(
//                 search
//               )

//             ||

//             user.email
//               .toLowerCase()
//               .includes(
//                 search
//               );


//           const matchesRole =

//             selectedRole.length === 0

//             ||

//             selectedRole.includes(
//               user.role
//             );

//           return (
//             matchesSearch &&
//             matchesRole
//           );

//         }
//       );

//     },
//       [
//         users,
//         searchTerm,
//         selectedRole,
//       ]
//     );

//   const [
//     openModal,
//     setOpenModal,
//   ] = useState(
//     false
//   );


//   return (

//     <div className="mt-8">

//       {/* Search + Filter */}


//       <div className="flex items-center justify-between mb-6">

//         {/* Left side */}
//         <div className="flex items-center gap-3">

//           <SearchBar
//             value={searchTerm}
//             onChange={setSearchTerm}
//             placeholder="Search by name or email"
//           />

//           <FilterDropdown
//             values={
//               selectedRole
//             }
//             onChange={
//               setSelectedRole
//             }
//             options={
//               ROLE_OPTIONS
//             }
//             placeholder="Roles"
//           />

//         </div>


//         {/* Right side */}

//         <button
//           onClick={() =>
//             setOpenModal(true)
//           }
//           className="
//       flex
//       items-center
//       gap-2
//       px-5  
//       py-2
//       rounded-md
//       bg-red-500
//       text-white
//       font-medium
//       text-sm
//       hover:bg-red-600
//       hover:cursor-pointer
//       transition
//     "
//         >
//           <Plus size={18} />

//           Create User

//         </button>

//       </div>


//       {/* Table */}

//       <section className="bg-white rounded-lg border border-gray-200 px-5 py-3">

//         <div className="overflow-x-auto">

//           <table className="w-full text-sm">

//             <thead>

//               <tr className="text-xs uppercase tracking-wide text-red-500 border-b border-gray-200">

//                 <th className="text-left py-2 pb-3 pl-2 font-semibold">
//                   User
//                 </th>
//                 <th className="text-left py-2 pb-3 font-semibold">
//                   Email
//                 </th>
//                 <th className="text-left py-2 pb-3 font-semibold">
//                   Role
//                 </th>

//               </tr>

//             </thead>



//             <tbody>

//               {isLoading && (

//                 <tr>

//                   <td
//                     colSpan={3}
//                     className="py-10 text-center text-sm text-gray-500"
//                   >
//                     Loading users...
//                   </td>

//                 </tr>

//               )}



//               {isError && (

//                 <tr>

//                   <td
//                     colSpan={3}
//                     className="py-10 text-center text-sm text-red-500"
//                   >
//                     Couldn't load users.
//                   </td>

//                 </tr>

//               )}



//               {
//                 !isLoading &&
//                 filteredUsers.length === 0 && (

//                   <tr>

//                     <td
//                       colSpan={3}
//                       className="py-10 text-center text-sm text-gray-500"
//                     >
//                       No users found
//                     </td>

//                   </tr>

//                 )
//               }



//               {
//                 filteredUsers.map(
//                   (user) => (

//                     <tr
//                       key={
//                         user.id
//                       }
//                       className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition"
//                     >

//                       {/* User */}

//                       <td className="py-4">

//                         <div className="flex items-center gap-3">

//                           <div className="w-9 h-9 text-sm rounded-full bg-red-500 flex items-center justify-center">

//                             <span className="text-sm font-semibold text-white">
//                               {
//                                 `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
//                                   .toUpperCase()
//                               }
//                             </span>

//                           </div>

//                           <div>

//                             <p className="text-sm font-medium text-gray-800">

//                               {
//                                 user.firstName
//                               }{" "}
//                               {
//                                 user.lastName
//                               }

//                             </p>

//                           </div>

//                         </div>

//                       </td>



//                       {/* Email */}

//                       <td className="py-4">

//                         <div className="flex items-center gap-2 text-gray-700">

//                           <Mail
//                             size={15}
//                             className="text-gray-500"
//                           />

//                           {
//                             user.email
//                           }

//                         </div>

//                       </td>

//                       {/* Role */}

//                       <td className="py-4">

//                         <span
//                           className={`
//       px-3
//       py-1
//       rounded-md
//       text-xs
//       font-medium
//       ${user.role === "ESTIMATOR"
//                               ? "bg-blue-100 text-blue-700"
//                               : "bg-yellow-100 text-yellow-700"
//                             }
//     `}
//                         >

//                           {
//                             user.role.replace(
//                               "_",
//                               " "
//                             )
//                           }

//                         </span>

//                       </td>

//                     </tr>

//                   )
//                 )
//               }

//             </tbody>

//           </table>

//         </div>



//         {/* Pagination */}

//         <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">

//           <p className="text-sm text-gray-500">

//             Showing{" "}

//             <span className="font-medium text-red-500">

//               {
//                 filteredUsers.length
//               }

//             </span>

//             {" "}of{" "}

//             <span className="font-medium text-red-500">

//               {
//                 users.length
//               }

//             </span>

//             {" "}results

//           </p>


//           <div className="flex items-center gap-2">

//             <button
//               type="button"
//               className="px-4 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:border-red-500 hover:text-red-500 hover:cursor-pointer transition"
//             >
//               Previous
//             </button>


//             <button
//               type="button"
//               className="px-4 py-1.5 text-sm border border-gray-300 rounded-md text-gray-600 hover:border-red-500 hover:text-red-500 hover:cursor-pointer transition"
//             >
//               Next
//             </button>

//           </div>

//         </div>

//       </section>

//       {openModal && (
//         <CreateUserModal
//           onClose={() =>
//             setOpenModal(false)
//           }
//         />
//       )}

//     </div>

//   );

// };

// export default UserTable;

import {
  useMemo,
  useState,
} from "react";

import {
  Mail,
  Plus,
  KeyRound,
} from "lucide-react";

import {
  useUsers,
  useResetUserPassword,
} from "../query/manage-user.query";

import SearchBar from "@/components/ui/SearchBar";
import FilterDropdown from "@/components/ui/Filter";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import CreateUserModal from "./CreateUserModal";
import { showToast } from "@/components/ui/toast";
import type { User as UserType } from "@/services/manage-user";
import { getUserManagementErrorMessage } from "../utils";
import { useAuth } from "@/context/AuthContext";
import { canManageRole, formatRoleLabel } from "@/shared/lib/roleAccess";

const ROLE_OPTIONS = [
    {
    label: "System_Admin",
    value: "SYSTEM_ADMIN",
  },
  {
    label: "Estimator",
    value: "ESTIMATOR",
  },
  {
    label: "Sales Manager",
    value: "SALES_MANAGER",
  },
  {
    label: "Head of Division",
    value: "HEAD_OF_DIVISION",
  },
];

const ITEMS_PER_PAGE = 6;

const UserTable = () => {

  const { role: viewerRole } = useAuth();

  const {
    data: users = [],
    isLoading,
    isError,
  } = useUsers();

  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    selectedRole,
    setSelectedRole,
  ] = useState<string[]>(
    []
  );

  const [
    currentPage,
    setCurrentPage,
  ] = useState(1);

  const filteredUsers =
    useMemo(() => {

      return users.filter(
        (user) => {

          const search =
            searchTerm.toLowerCase();

          const matchesSearch =

            user.firstName
              .toLowerCase()
              .includes(
                search
              )

            ||

            user.lastName
              .toLowerCase()
              .includes(
                search
              )

            ||

            user.email
              .toLowerCase()
              .includes(
                search
              );

          const matchesRole =

            selectedRole.length === 0

            ||

            selectedRole.includes(
              user.role
            );

          return (
            matchesSearch &&
            matchesRole
          );

        }
      );

    },
      [
        users,
        searchTerm,
        selectedRole,
      ]
    );

  const totalPages =
    Math.ceil(
      filteredUsers.length /
      ITEMS_PER_PAGE
    );

  const paginatedUsers =
    filteredUsers.slice(
      (
        currentPage - 1
      ) * ITEMS_PER_PAGE,
      currentPage * ITEMS_PER_PAGE
    );

  const [
    openModal,
    setOpenModal,
  ] = useState(
    false
  );

  const resetPasswordMutation = useResetUserPassword();
  const [passwordResetUser, setPasswordResetUser] = useState<UserType | null>(null);

  const handleResetPassword = (user: UserType) => {
    setPasswordResetUser(user);
  };

  const confirmPasswordReset = () => {
    if (!passwordResetUser || resetPasswordMutation.isPending) return;
    resetPasswordMutation.mutate(passwordResetUser.id, {
      onSuccess: (response: { message?: string }) => {
        showToast(
          "success",
          response?.message ?? "Password reset link has been sent to your email.",
        );
      },
      onError: (error: unknown) => {
        showToast(
          "error",
          getUserManagementErrorMessage(error, "Failed to send reset link."),
        );
      },
      onSettled: () => setPasswordResetUser(null),
    });
  };

  return (

    <div>

      {/* Search + Filter */}

      <div className="flex items-center justify-between mb-6">

        {/* Left side */}

        <div className="flex items-center gap-3">

          <SearchBar
            value={searchTerm}
            onChange={(value: any) => {

              setSearchTerm(value);

              setCurrentPage(1);

            }}
            placeholder="Search by name or email"
          />

          <FilterDropdown
            values={
              selectedRole
            }
            onChange={(roles) => {

              setSelectedRole(roles);

              setCurrentPage(1);

            }}
            options={
              ROLE_OPTIONS
            }
            placeholder="Roles"
          />

        </div>

        {/* Right side */}

        <button
          onClick={() =>
            setOpenModal(true)
          }
          className="
            flex
            items-center
            gap-2
            px-5
            py-2
            rounded-md
            bg-red-500
            text-white
            font-medium
            text-sm
            hover:bg-red-600
            hover:cursor-pointer
            transition
          "
        >

          <Plus size={18} />

          Create User

        </button>

      </div>


      {/* Table */}

      <section className="bg-white rounded-lg border border-gray-200 px-5 py-3">

        <div className="overflow-x-auto min-h-[430px]">

          <table className="w-full text-sm">

            <thead>

              <tr className="text-xs uppercase tracking-wide text-red-500 border-b border-gray-200">

                <th className="text-left py-2 pb-3 pl-2 font-semibold">
                  User
                </th>

                <th className="text-left py-2 pb-3 font-semibold">
                  Email
                </th>

                <th className="text-left py-2 pb-3 font-semibold">
                  Role
                </th>

                <th className="text-right py-2 pb-3 pr-2 font-semibold">
                  Actions
                </th>

              </tr>

            </thead>

            <tbody>

              {isLoading && (

                <tr>

                  <td
                    colSpan={4}
                    className="py-10 text-center text-sm text-gray-500"
                  >
                    Loading users...
                  </td>

                </tr>

              )}


              {isError && (

                <tr>

                  <td
                    colSpan={4}
                    className="py-10 text-center text-sm text-red-500"
                  >
                    Couldn't load users.
                  </td>

                </tr>

              )}


              {
                !isLoading &&
                filteredUsers.length === 0 && (

                  <tr>

                    <td
                      colSpan={4}
                      className="py-10 text-center text-sm text-red-500 font-semibold"
                    >
                      No users found
                    </td>

                  </tr>

                )
              }


              {
                paginatedUsers.map(
                  (user) => (

                    <tr
                      key={
                        user.id
                      }
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition"
                    >

                      {/* User */}

                      <td className="py-4">

                        <div className="flex items-center gap-3">

                          <div className="w-9 h-9 text-sm rounded-full bg-red-500 flex items-center justify-center">

                            <span className="text-sm font-semibold text-white">

                              {
                                `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`
                                  .toUpperCase()
                              }

                            </span>

                          </div>

                          <div>

                            <p className="text-sm font-medium text-gray-800">

                              {
                                user.firstName
                              }{" "}
                              {
                                user.lastName
                              }

                            </p>

                          </div>

                        </div>

                      </td>


                      {/* Email */}

                      <td className="py-4">

                        <div className="flex items-center gap-2 text-gray-700">

                          <Mail
                            size={15}
                            className="text-gray-500"
                          />

                          {
                            user.email
                          }

                        </div>

                      </td>


                      {/* Role */}

                      <td className="py-4">

                        <span
                          className={`
                            px-3
                            py-1
                            rounded-md
                            text-xs
                            font-medium
                            ${
                              user.role === "ESTIMATOR"
                                ? "bg-blue-100 text-blue-700"
                                : user.role === "HEAD_OF_DIVISION"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-yellow-100 text-yellow-700"
                            }
                          `}
                        >

                          {formatRoleLabel(user.role)}

                        </span>

                      </td>

                      {/* Actions */}

                      <td className="py-4">

                        <div className="flex items-center justify-end pr-2">

                          <button
                            type="button"
                            onClick={() => handleResetPassword(user)}
                            disabled={resetPasswordMutation.isPending || !canManageRole(viewerRole, user.role)}
                            title={
                              canManageRole(viewerRole, user.role)
                                ? "Send reset password link"
                                : "Only Super Admin can manage Head of Division"
                            }
                            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-green-50 hover:text-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <KeyRound size={15} />
                            Reset password
                          </button>

                        </div>

                      </td>

                    </tr>

                  )
                )
              }

            </tbody>

          </table>

        </div>


        {/* Pagination */}

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">

          <p className="text-sm text-gray-500">

            Showing{" "}

            <span className="font-medium text-red-500">

              {
                filteredUsers.length === 0
                  ? 0
                  : (
                    (
                      currentPage - 1
                    ) * ITEMS_PER_PAGE
                  ) + 1
              }

            </span>

            {" "}to{" "}

            <span className="font-medium text-red-500">

              {
                Math.min(
                  currentPage *
                  ITEMS_PER_PAGE,
                  filteredUsers.length
                )
              }

            </span>

            {" "}of{" "}

            <span className="font-medium text-red-500">

              {
                filteredUsers.length
              }

            </span>

            {" "}results

          </p>


          <div className="flex items-center gap-2">

            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() =>
                setCurrentPage(
                  (prev) =>
                    Math.max(
                      prev - 1,
                      1
                    )
                )
              }
              className="
                px-4
                py-1.5
                text-sm
                border
                border-gray-300
                rounded-md
                text-gray-600
                hover:border-red-500
                hover:text-red-500
                hover:cursor-pointer
                transition
                disabled:opacity-50
                disabled:cursor-not-allowed
              "
            >
              Previous
            </button>


            <div className="px-3 text-sm font-medium text-red-500">

              {
                currentPage
              }
              {" / "}
              {
                totalPages || 1
              }

            </div>


            <button
              type="button"
              disabled={
                currentPage === totalPages ||
                totalPages === 0
              }
              onClick={() =>
                setCurrentPage(
                  (prev) =>
                    Math.min(
                      prev + 1,
                      totalPages
                    )
                )
              }
              className="
                px-4
                py-1.5
                text-sm
                border
                border-gray-300
                rounded-md
                text-gray-600
                hover:border-red-500
                hover:text-red-500
                hover:cursor-pointer
                transition
                disabled:opacity-50
                disabled:cursor-not-allowed
              "
            >
              Next
            </button>

          </div>

        </div>

      </section>

      {openModal && (

        <CreateUserModal
          onClose={() =>
            setOpenModal(false)
          }
        />

      )}

      <ConfirmDialog
        open={Boolean(passwordResetUser)}
        title="Send password reset link?"
        message={`Send a password reset link to ${passwordResetUser?.firstName ?? "this team member"}?`}
        confirmLabel="Send reset link"
        isConfirming={resetPasswordMutation.isPending}
        onCancel={() => setPasswordResetUser(null)}
        onConfirm={confirmPasswordReset}
      />

    </div>

  );

};

export default UserTable;
