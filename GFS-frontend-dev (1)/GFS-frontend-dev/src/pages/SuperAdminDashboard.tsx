import SuperAdminUserTable from "@/features/super-admin/manage-users/components/SuperAdminUserTable";

const SuperAdminDashboard = () => {
   return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="border-l-3 border-red-500 px-4">
        <div className="text-2xl font-medium text-red-500 leading-[1.9rem]">
          Super Admin Dashboard
        </div>

        {/* <div className="text-md text-gray-500 mt-2">
          Manage users, monitor system activity and control platform operations.
        </div> */}
      </div>

      {/* Center Content */}
      <div className="flex-1 flex items-center justify-center">

        <div className="text-center">

          <h1 className="text-4xl font-semibold text-red-500">
            Welcome, Super-Admin
          </h1>

          <p className="text-gray-500 mt-2 max-w-[600px] text-lg">
            Manage users, configure roles and oversee system operations
            from a centralized dashboard.
          </p>

        </div>

      </div>

    </div>
  );
  
}

export default SuperAdminDashboard
