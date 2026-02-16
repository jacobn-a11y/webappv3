"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  BookOpen,
  FileText,
  MessageSquare,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { label: "Accounts", href: "/accounts", icon: Users },
  { label: "Stories", href: "/stories", icon: BookOpen },
  { label: "Landing Pages", href: "/landing-pages", icon: FileText },
  { label: "Chatbot", href: "/chatbot", icon: MessageSquare },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-16 flex-col items-center border-r bg-background py-4 lg:w-56">
        <Link
          href="/"
          className="mb-8 flex items-center gap-2 px-3 font-semibold text-lg"
        >
          <BookOpen className="h-6 w-6 shrink-0 text-primary" />
          <span className="hidden lg:inline">StoryEngine</span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 w-full px-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="hidden lg:inline">{item.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="lg:hidden">
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
