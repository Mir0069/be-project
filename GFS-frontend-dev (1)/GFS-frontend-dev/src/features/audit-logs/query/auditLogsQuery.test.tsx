import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAuditLogs } from "./auditLogsQuery";
import { fetchAuditLogs } from "@/services/audit-logs";

const viewer = vi.hoisted(() => ({ user: { id: "manager" }, role: "SALES_MANAGER" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => viewer }));
vi.mock("@/services/audit-logs", () => ({ fetchAuditLogs: vi.fn() }));

it("does not reuse manager history when the signed-in viewer changes", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  vi.mocked(fetchAuditLogs).mockResolvedValueOnce({ items: [], total: 10, totalPages: 1, page: 1, limit: 25 });
  const hook = renderHook(() => useAuditLogs({ projectId: "project" }), { wrapper });
  await waitFor(() => expect(hook.result.current.data?.total).toBe(10));
  viewer.user.id = "estimator";
  viewer.role = "ESTIMATOR";
  vi.mocked(fetchAuditLogs).mockResolvedValueOnce({ items: [], total: 2, totalPages: 1, page: 1, limit: 25 });
  hook.rerender();
  expect(hook.result.current.data?.total).not.toBe(10);
  await waitFor(() => expect(hook.result.current.data?.total).toBe(2));
  hook.unmount();
  client.clear();
});
