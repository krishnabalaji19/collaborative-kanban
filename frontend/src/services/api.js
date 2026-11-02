import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

const api = axios.create({ baseURL: `${API_URL}/api` });

// Active tenant is kept in memory and sent on every request.
// The server still verifies membership, so this header cannot grant access.
let activeTenantId = null;
export const setActiveTenant = (id) => {
  activeTenantId = id;
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (activeTenantId) config.headers["x-tenant-id"] = activeTenantId;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== "/login") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

export default api;
