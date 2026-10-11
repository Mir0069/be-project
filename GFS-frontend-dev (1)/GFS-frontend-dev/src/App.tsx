import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

// Eager: the guards, the shell and the login screen are on the critical path for
// the very first paint, so code-splitting them would only add a round trip.
import LoginPage from "./features/auth/pages/LoginPage";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import PublicRoute from "@/components/auth/PublicRoute";
import RoleGuard from "@/components/auth/RoleGuard";
import AppLayout from "@/components/layout/AppLayout";
import SplashGate from "@/components/ui/SplashGate";

// Lazy: every route below is fetched only when it is actually visited. Importing
// them eagerly put all 435 modules into one 878 kB bundle, so nothing rendered
// until the whole app had downloaded and parsed. That is what produced both the
// slow first load and the flash of unstyled content before the app mounted.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ManageUsersPage = lazy(
  () => import("./features/system-admin/manage-users/pages/ManageUsersPage"),
);

const SalesManagerProjects = lazy(
  () => import("@/features/sales-manager/projects/pages/Projects"),
);
const CreateProjectPage = lazy(
  () => import("@/features/sales-manager/create-project/pages/CreateProject"),
);
const EstimatorProjects = lazy(
  () => import("@/features/estimator/my-projects/pages/Projects"),
);
const NotificationsPage = lazy(
  () => import("@/features/notifications/pages/NotificationsPage"),
);
const AuditLogsPage = lazy(
  () => import("@/features/audit-logs/pages/AuditLogsPage"),
);

const WorkspaceLayout = lazy(
  () => import("@/features/estimator/workspace/pages/components/WorkspaceLayout"),
);
const WorkspaceDocuments = lazy(
  () => import("@/features/estimator/workspace/pages/Documents"),
);
const WorkspaceAIInsight = lazy(
  () => import("@/features/estimator/workspace/pages/AIInsight"),
);
const WorkspaceParameters = lazy(
  () => import("@/features/estimator/workspace/pages/Parameters"),
);
const WorkspaceBOMPricing = lazy(
  () => import("@/features/estimator/workspace/pages/BOMPricing"),
);
const WorkspaceProposal = lazy(
  () => import("@/features/estimator/workspace/pages/Proposal"),
);
const WorkspaceTimeline = lazy(
  () => import("@/features/estimator/workspace/pages/Timeline"),
);
const WorkspaceProjectHeader = lazy(
  () => import("@/features/estimator/workspace/pages/ProjectHeader"),
);
const WorkspaceFinalParameters = lazy(
  () => import("@/features/estimator/workspace/pages/FinalParameters"),
);
const WorkspaceGlassType = lazy(
  () => import("@/features/estimator/workspace/pages/GlassType"),
);
const WorkspaceFrameType = lazy(
  () => import("@/features/estimator/workspace/pages/FrameType"),
);
const WorkspaceAddons = lazy(
  () => import("@/features/estimator/workspace/pages/Addons"),
);

const RegisterPage = lazy(() => import("./features/auth/pages/RegisterPage"));
const ProjectDashboard = lazy(() => import("./pages/ProjectDashboard"));
const SetPasswordPage = lazy(
  () => import("./features/set-password/pages/SetPasswordPage"),
);
const ForgotPasswordPage = lazy(
  () => import("./features/auth/pages/ForgotPasswordPage"),
);

const StatusReportDashboard = lazy(
  () => import("./features/kanban/pages/ProjectKaban"),
);
const ProjectKanbanBoard = lazy(
  () => import("./features/kanban/pages/ProjectKanbanBoard"),
);
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const SuperAdminUserTable = lazy(
  () =>
    import("./features/super-admin/manage-users/components/SuperAdminUserTable"),
);

const DraftsPage = lazy(
  () => import("@/features/sales-manager/projects/pages/DraftsPage"),
);
const PartnerList = lazy(() => import("@/features/partners/pages/PartnerList"));
const DocumentPreviewPage = lazy(() => import("@/features/documents/pages/DocumentPreviewPage"));

// Shown only while a route chunk is in flight. Styled, so the transition never
// shows raw unstyled markup.
const RouteFallback = () => (
  <div className="flex h-screen w-full items-center justify-center bg-white">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-red-600" />
  </div>
);

// CreateProjectProvider is small and pulled in with its page, so it stays eager.
import { CreateProjectProvider } from "./features/sales-manager/create-project/context/CreateProjectContext";

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
      <Routes>

        {/* Public Routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <SplashGate>
                <LoginPage />
              </SplashGate>
            </PublicRoute>
          }
        />

        <Route path="/set-password" element={<SetPasswordPage />} />

        <Route path="/reset-password" element={<SetPasswordPage />} />

        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route
          path="/"
          element={
            <PublicRoute>
              <Navigate to="/login" replace />
            </PublicRoute>
          }
        />

        {/* Protected Routes */}
        {/* System Admin Routes */}
        <Route
          path="/sys-admin"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <AdminDashboard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/super-admin"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN"]}>
                <AppLayout>
                  <SuperAdminDashboard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/super-admin/manage-users"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN"]}>
                <AppLayout>
                  <SuperAdminUserTable />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/super-admin/audit-logs"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN"]}>
                <AppLayout>
                  <AuditLogsPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/register"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <RegisterPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/sys-admin/manage-users"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <ManageUsersPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/sys-admin/audit-logs"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SUPER_ADMIN", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <AuditLogsPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        {/* Sales Manager Routes */}
        <Route
          path="/sales-manager/drafts"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <DraftsPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        
        <Route
          path="/sales-manager"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <StatusReportDashboard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/sales-manager/projects"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <SalesManagerProjects />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        {/* <Route
          path="/sales-manager/projects/:projectId"
          element={
            <ProtectedRoute>
              <RoleGuard
                allowedRoles={[
                  "SALES_MANAGER", "SYSTEM_ADMIN",
                ]}
              >
                <AppLayout>
                  <SalesManagerProjectDetail />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        /> */}

        {/* <Route
          path="/projects/:projectId/dashboard"
          element={
            <ProtectedRoute>
              <RoleGuard
                allowedRoles={[
                  "SALES_MANAGER", "SYSTEM_ADMIN", "ESTIMATOR",
                ]}
              >
                <AppLayout>
                  <ProjectDashboard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        /> */}

        <Route
          path="/sales-manager/notifications"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <NotificationsPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/sales-manager/audit-logs"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <AuditLogsPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/sales-manager/create-project"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <CreateProjectProvider>
                    <CreateProjectPage />
                  </CreateProjectProvider>
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />
        {/*
        <Route
          path="/sales-manager/create-project/zoho-lead/:leadId"
          element={
            <ProtectedRoute>
              <RoleGuard
                allowedRoles={[
                  "SALES_MANAGER", "SYSTEM_ADMIN",
                ]}
              >
                <AppLayout>
                  <ZohoLeadDetail />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        /> */}

        {/* Estimator Routes */}
        <Route
          path="/estimator"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["ESTIMATOR", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <StatusReportDashboard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/estimator/projects"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["ESTIMATOR", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <EstimatorProjects />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/estimator/notifications"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["ESTIMATOR", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <NotificationsPage />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/sales-manager/project-kanban"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <ProjectKanbanBoard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/sales-manager/partners"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["SALES_MANAGER", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <PartnerList />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        <Route
          path="/estimator/project-kanban"
          element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={["ESTIMATOR", "SYSTEM_ADMIN"]}>
                <AppLayout>
                  <ProjectKanbanBoard />
                </AppLayout>
              </RoleGuard>
            </ProtectedRoute>
          }
        />

        {/* <Route
          path="/projects/:projectId"
          element={
            <ProtectedRoute>
              <RoleGuard
                allowedRoles={[
                  "ESTIMATOR", "SYSTEM_ADMIN",
                ]}
              >
                <WorkspaceLayout />
              </RoleGuard>
            </ProtectedRoute>
          }
        >

          <Route index element={<Navigate to="documents" replace />} />
          <Route path="documents" element={<WorkspaceDocuments />} />
          <Route path="ai-insight" element={<WorkspaceAIInsight />} />
          <Route path="parameters" element={<WorkspaceParameters />} />
          <Route path="bom" element={<WorkspaceBOMPricing />} />
          <Route path="proposal" element={<WorkspaceProposal />} />

          <Route path="timeline" element={<WorkspaceTimeline />} />
        </Route> */}

        {/* Document Preview Route */}
        <Route
          path="/preview/:documentId"
          element={<DocumentPreviewPage />}
        />

        {/* Project Workspace */}

        <Route
          path="/projects/:projectId"
          element={
            <ProtectedRoute>
              <RoleGuard
                allowedRoles={["ESTIMATOR", "SYSTEM_ADMIN", "SALES_MANAGER", "SUPER_ADMIN"]}
              >
                <WorkspaceLayout />
              </RoleGuard>
            </ProtectedRoute>
          }
        >
          {/* Default */}
          <Route index element={<Navigate to="dashboard" replace />} />

          {/* NEW */}
          <Route path="dashboard" element={<ProjectDashboard />} />

          <Route path="documents" element={<WorkspaceDocuments />} />

          <Route path="ai-insight" element={<WorkspaceAIInsight />} />

          <Route path="header" element={<WorkspaceProjectHeader />} />

          <Route path="project-header" element={<WorkspaceProjectHeader />} />

          <Route path="glass-type" element={<WorkspaceGlassType />} />

          <Route path="frame-type" element={<WorkspaceFrameType />} />

          <Route path="parameters" element={<WorkspaceParameters />} />

          <Route path="addons" element={<WorkspaceAddons />} />

          <Route path="bom" element={<WorkspaceBOMPricing />} />

          <Route path="proposal" element={<WorkspaceProposal />} />

          <Route path="final-parameters" element={<WorkspaceFinalParameters />} />

          <Route path="timeline" element={<WorkspaceTimeline />} />

          <Route path="audit-logs" element={<AuditLogsPage />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
