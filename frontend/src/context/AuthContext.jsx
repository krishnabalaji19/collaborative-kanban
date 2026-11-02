import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import api, { setActiveTenant } from "../services/api";
import { connectSocket, disconnectSocket } from "../services/socket";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [orgId, setOrgId] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [loading, setLoading] = useState(true);

  const pickTenant = (id) => {
    setActiveTenant(id); // set immediately so the next request uses the new tenant
    setTenantId(id);
    if (id) localStorage.setItem("tenantId", id);
  };

  // Organizations and tenants always come from the backend (never hardcoded)
  const loadMe = useCallback(async () => {
    const { data } = await api.get("/auth/me");
    setUser(data.user);
    setOrganizations(data.organizations);

    const saved = localStorage.getItem("tenantId");
    const org =
      data.organizations.find((o) => o.tenants.some((t) => t.id === saved)) ||
      data.organizations[0];
    if (org) {
      setOrgId(org.id);
      const tenant = org.tenants.find((t) => t.id === saved) || org.tenants[0];
      pickTenant(tenant ? tenant.id : null);
    }
    connectSocket(localStorage.getItem("token"));
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      setLoading(false);
      return;
    }
    loadMe()
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, [loadMe]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    await loadMe();
  };

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("tenantId");
    disconnectSocket();
    setActiveTenant(null);
    setUser(null);
    setOrganizations([]);
    setOrgId(null);
    setTenantId(null);
  };

  const selectOrg = (id) => {
    const org = organizations.find((o) => o.id === id);
    if (!org) return;
    setOrgId(id);
    pickTenant(org.tenants[0] ? org.tenants[0].id : null);
  };

  const currentOrg = organizations.find((o) => o.id === orgId) || null;
  const currentTenant =
    currentOrg?.tenants.find((t) => t.id === tenantId) || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        organizations,
        currentOrg,
        currentTenant,
        loading,
        login,
        logout,
        selectOrg,
        selectTenant: pickTenant,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
