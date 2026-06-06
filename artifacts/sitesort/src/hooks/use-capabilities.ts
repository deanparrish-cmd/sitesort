import { useGetMe } from "@workspace/api-client-react";

export type Role = "admin" | "project_manager" | "site_worker" | "subcontractor";

export type Capabilities = {
  role: Role | null;
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isInternal: boolean;
  canViewAdmin: boolean;
  canManageCompany: boolean;
  canManageProjects: boolean;
  canManageTeam: boolean;
  canManageSubcontractors: boolean;
  canManageCompliance: boolean;
  canManageInvoices: boolean;
  canUploadDocument: boolean;
  canBroadcast: boolean;
  canLogPhoto: boolean;
  canSignOff: boolean;
};

// Pure derivation so it can be unit-tested and reused without React.
// Roles: admin > project_manager > site_worker > subcontractor.
// "managers" = admin or project_manager. "internal" = managers or site_worker.
export function deriveCapabilities(role: Role | null): Omit<Capabilities, "isLoading"> {
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "project_manager";
  const isInternal = isManager || role === "site_worker";
  return {
    role,
    isAdmin,
    isManager,
    isInternal,
    canViewAdmin: isAdmin,
    canManageCompany: isAdmin,
    canManageProjects: isManager,
    canManageTeam: isManager,
    canManageSubcontractors: isManager,
    canManageCompliance: isManager,
    canManageInvoices: isManager,
    canUploadDocument: isManager,
    canBroadcast: isManager,
    canLogPhoto: isInternal,
    canSignOff: role != null,
  };
}

export function useCapabilities(): Capabilities {
  const { data: user, isLoading } = useGetMe();
  const role = (user?.role as Role | undefined) ?? null;
  return { isLoading, ...deriveCapabilities(role) };
}
