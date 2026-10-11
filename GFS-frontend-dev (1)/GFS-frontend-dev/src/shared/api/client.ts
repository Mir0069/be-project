// shared/api/client.ts

import axios from "axios";
import type {
  AxiosError,
  InternalAxiosRequestConfig,
} from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5000/api/v1";

const PUBLIC_PAGES = ["/", "/login", "/set-password", "/reset-password", "/forgot-password", "/register"];

const isAuthPage = () =>
  PUBLIC_PAGES.some((p) =>
    p === "/" ? window.location.pathname === "/" : window.location.pathname.startsWith(p)
  );

export const publicClient =
  axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
      "Content-Type":
        "application/json",
    },
  });

export const apiClient =
  axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    headers: {
      "Content-Type":
        "application/json",
    },
  });

apiClient.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Refresh Token
let refreshPromise: Promise<any> | null = null;

async function refreshToken() {
  const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await publicClient.post("/auth/refresh-token", {}, { headers });
  if (res.data?.accessToken) {
    localStorage.setItem("accessToken", res.data.accessToken);
  }
  return res;
}

function getRefreshPromise() {
  if (!refreshPromise) {
    refreshPromise =
      refreshToken().finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

type ErrorPayload = {
  error?: { message?: unknown };
  message?: unknown;
};

const parseErrorPayload = async (data: unknown): Promise<ErrorPayload | null> => {
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      return parsed && typeof parsed === "object" ? parsed as ErrorPayload : null;
    } catch {
      return null;
    }
  }

  return data && typeof data === "object" ? data as ErrorPayload : null;
};

const getErrorMessage = (payload: ErrorPayload | null, fallback: string): string => {
  const nestedMessage = payload?.error?.message;
  if (typeof nestedMessage === "string" && nestedMessage.trim()) return nestedMessage;

  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
  return fallback;
};

// Response Interceptors
apiClient.interceptors.response.use(
  (response) => response,

  async (error: AxiosError) => {

    if (!error.config) {
      const payload = await parseErrorPayload(error.response?.data);
      return Promise.reject({
        status:
          error.response?.status,
        message: getErrorMessage(payload, error.message || "Something went wrong"),
        data: payload ?? error.response?.data,
      });
    }

    const originalRequest =
      error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

    const reqUrl = originalRequest.url || '';
    const isAuthEndpoint = reqUrl.includes('/auth/me') || reqUrl.includes('/auth/refresh-token') || reqUrl.includes('/auth/login');

    // 401 + Protected Page & Protected Endpoint Only
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthPage() &&
      !isAuthEndpoint
    ) {
      originalRequest._retry = true;

      try {
        /* Try refresh */
        await getRefreshPromise();

        /* Retry original */
        return apiClient(
          originalRequest
        );
      } catch (refreshError) {
        /* Session expired - avoid hard reload if on public pages */
        if (!isAuthPage()) {
          window.location.href = "/login";
        }

        return Promise.reject(
          refreshError
        );
      }
    }

    // Normal Error — preserve the backend body so callers can read
    // error.data.error.details (e.g. the Teams "already linked" prompt).
    const payload = await parseErrorPayload(error.response?.data);

    return Promise.reject({
      status:
        error.response?.status,
      message: getErrorMessage(payload, error.message || "Something went wrong"),
      data: payload ?? error.response?.data,
    });
  }
);
