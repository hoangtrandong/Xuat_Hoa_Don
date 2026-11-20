"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";

export interface DistributorOption {
  id: number;
  code: string;
  name: string;
  tax_code: string;
  status: string;
}

interface DistributorContextValue {
  distributors: DistributorOption[];
  loadingDistributors: boolean;
  /** ID NPP hiệu lực: User NPP luôn là distributorId của họ; Super Admin là NPP đang chọn trên Switcher hoặc null (Tất cả NPP). */
  effectiveDistributorId: number | null;
  effectiveDistributor: DistributorOption | null;
  isSuperAdmin: boolean;
  /** True khi Super Admin đang ở chế độ xem "Tất cả NPP". */
  isAllDistributorsMode: boolean;
  setSelectedDistributorId: (id: number | null) => void;
  refreshDistributors: () => void;
}

const ACTIVE_DIST_KEY = "dms-active-distributor-filter";

const DistributorContext = createContext<DistributorContextValue>({
  distributors: [],
  loadingDistributors: false,
  effectiveDistributorId: null,
  effectiveDistributor: null,
  isSuperAdmin: false,
  isAllDistributorsMode: false,
  setSelectedDistributorId: () => {},
  refreshDistributors: () => {},
});

export function DistributorProvider({ children }: { children: React.ReactNode }) {
  const session = useAuthSession();
  const [distributors, setDistributors] = useState<DistributorOption[]>([]);
  const [loadingDistributors, setLoadingDistributors] = useState(false);
  const [selectedDistributorId, setSelectedDistributorIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(ACTIVE_DIST_KEY);
    if (!raw || raw === "ALL") return null;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  });

  const loadDistributors = useCallback(() => {
    if (!session.ready || !session.token) return;
    if (!session.isSuperAdmin && session.distributorId) {
      setDistributors([
        {
          id: session.distributorId,
          code: session.distributorCode,
          name: session.distributorName,
          tax_code: session.distributorTaxCode,
          status: "active",
        },
      ]);
      return;
    }
    setLoadingDistributors(true);
    apiFetch(`${API_URL}/einvoice/distributors`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Array<Record<string, unknown>>) => {
        const mapped: DistributorOption[] = list.map((d) => ({
          id: Number(d.id),
          code: String(d.code ?? ""),
          name: String(d.name ?? ""),
          tax_code: String(d.tax_code ?? ""),
          status: String(d.status ?? "active"),
        }));
        setDistributors(mapped);
      })
      .catch(() => {})
      .finally(() => setLoadingDistributors(false));
  }, [
    session.ready,
    session.token,
    session.isSuperAdmin,
    session.distributorId,
    session.distributorCode,
    session.distributorName,
    session.distributorTaxCode,
  ]);

  useEffect(() => {
    loadDistributors();
  }, [loadDistributors]);

  const setSelectedDistributorId = useCallback((id: number | null) => {
    setSelectedDistributorIdState(id);
    if (typeof window !== "undefined") {
      if (id === null) {
        window.sessionStorage.setItem(ACTIVE_DIST_KEY, "ALL");
      } else {
        window.sessionStorage.setItem(ACTIVE_DIST_KEY, String(id));
      }
    }
  }, []);

  const effectiveDistributorId = session.isSuperAdmin
    ? selectedDistributorId
    : session.distributorId ?? null;

  const effectiveDistributor = useMemo(() => {
    if (effectiveDistributorId === null) return null;
    const found = distributors.find((d) => d.id === effectiveDistributorId);
    if (found) return found;
    if (!session.isSuperAdmin && session.distributorId === effectiveDistributorId) {
      return {
        id: session.distributorId,
        code: session.distributorCode,
        name: session.distributorName,
        tax_code: session.distributorTaxCode,
        status: "active",
      };
    }
    return null;
  }, [
    effectiveDistributorId,
    distributors,
    session.isSuperAdmin,
    session.distributorId,
    session.distributorCode,
    session.distributorName,
    session.distributorTaxCode,
  ]);

  const value = useMemo<DistributorContextValue>(
    () => ({
      distributors,
      loadingDistributors,
      effectiveDistributorId,
      effectiveDistributor,
      isSuperAdmin: session.isSuperAdmin,
      isAllDistributorsMode: session.isSuperAdmin && effectiveDistributorId === null,
      setSelectedDistributorId,
      refreshDistributors: loadDistributors,
    }),
    [
      distributors,
      loadingDistributors,
      effectiveDistributorId,
      effectiveDistributor,
      session.isSuperAdmin,
      setSelectedDistributorId,
      loadDistributors,
    ],
  );

  return (
    <DistributorContext.Provider value={value}>
      {children}
    </DistributorContext.Provider>
  );
}

export function useDistributorContext(): DistributorContextValue {
  return useContext(DistributorContext);
}
