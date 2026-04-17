"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

type OrgState = {
  organizationId: string | null;
  organizationName: string | null;
  setOrganization: (org: { id: string | null; name: string | null }) => void;
};

const OrganizationContext = createContext<OrgState | null>(null);
const ORGANIZATION_STORAGE_EVENT = "arenzyra:organization-storage";
const EMPTY_ORGANIZATION_SNAPSHOT = Object.freeze({
  id: null,
  name: null,
});

let organizationSnapshot: { id: string | null; name: string | null } =
  EMPTY_ORGANIZATION_SNAPSHOT;

function readOrganizationStorage() {
  if (typeof window === "undefined") {
    return EMPTY_ORGANIZATION_SNAPSHOT;
  }

  const nextId = localStorage.getItem("organizationId");
  const nextName = localStorage.getItem("organizationName");

  if (
    organizationSnapshot.id === nextId &&
    organizationSnapshot.name === nextName
  ) {
    return organizationSnapshot;
  }

  organizationSnapshot = {
    id: nextId,
    name: nextName,
  };
  return organizationSnapshot;
}

function subscribeToOrganizationStorage(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorageChange = (event: Event) => {
    if (
      event instanceof StorageEvent &&
      event.key &&
      event.key !== "organizationId" &&
      event.key !== "organizationName"
    ) {
      return;
    }
    onStoreChange();
  };

  window.addEventListener("storage", handleStorageChange);
  window.addEventListener(ORGANIZATION_STORAGE_EVENT, handleStorageChange);

  return () => {
    window.removeEventListener("storage", handleStorageChange);
    window.removeEventListener(ORGANIZATION_STORAGE_EVENT, handleStorageChange);
  };
}

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const organization = useSyncExternalStore(
    subscribeToOrganizationStorage,
    readOrganizationStorage,
    () => EMPTY_ORGANIZATION_SNAPSHOT,
  );

  const setOrganization = useCallback((org: { id: string | null; name: string | null }) => {
    if (typeof window !== "undefined") {
      if (org.id) {
        localStorage.setItem("organizationId", org.id);
        localStorage.setItem("organizationName", org.name ?? "");
      } else {
        localStorage.removeItem("organizationId");
        localStorage.removeItem("organizationName");
      }

      window.dispatchEvent(new Event(ORGANIZATION_STORAGE_EVENT));
    }
  }, []);

  const value = useMemo(
    () => ({
      organizationId: organization.id,
      organizationName: organization.name,
      setOrganization,
    }),
    [organization.id, organization.name, setOrganization],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization must be used within OrganizationProvider");
  return ctx;
}
