"use client";

import { useState } from "react";
import { ChevronsUpDown, Building2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/auth-context";

export function OrgSwitcher() {
  const { organizationMemberships, currentOrgId } = useSession();
  const [selectedOrgId, setSelectedOrgId] = useState(
    currentOrgId ?? organizationMemberships[0]?.organizationId ?? null
  );

  const currentOrg = organizationMemberships.find(
    (m) => m.organizationId === selectedOrgId
  );

  function handleOrgSwitch(orgId: string) {
    setSelectedOrgId(orgId);
    // In production, this would call an API to switch the active org
    // and set a cookie, then reload.
    document.cookie = `wos-org=${orgId};path=/;max-age=${60 * 60 * 24 * 30}`;
    window.location.reload();
  }

  if (organizationMemberships.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="h-4 w-4" />
        <span>No organization</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Building2 className="h-4 w-4" />
          <span className="max-w-[150px] truncate">
            {currentOrg?.organizationName ?? "Select org"}
          </span>
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {organizationMemberships.map((membership) => (
          <DropdownMenuItem
            key={membership.organizationId}
            onClick={() => handleOrgSwitch(membership.organizationId)}
            className="flex items-center justify-between"
          >
            <span className="truncate">
              {membership.organizationName ?? membership.organizationId}
            </span>
            {membership.organizationId === selectedOrgId && (
              <Check className="h-4 w-4 shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
