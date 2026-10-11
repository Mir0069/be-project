import UserTable from "../components/UserTable";

const ManageUsersPage = () => {


  return (
    <>
      <div className="border-l-3 border-red-500 px-4 space-y-1">

        <div className="text-2xl font-medium text-red-500">
          Manage Users
        </div>

      </div>

      <div className="mt-6">
        <UserTable />
      </div>

    </>
  );
};

export default ManageUsersPage;
