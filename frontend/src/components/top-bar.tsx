import { OrgSwitcher } from "@/components/org-switcher";
import { UserMenu } from "@/components/user-menu";
import { MobileSidebar } from "@/components/mobile-sidebar";

export function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-3">
        <MobileSidebar />
        <OrgSwitcher />
      </div>
      <UserMenu />
    </header>
  );
}
