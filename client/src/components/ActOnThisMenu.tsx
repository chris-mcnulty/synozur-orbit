import { useLocation } from "wouter";
import { Sparkles, Megaphone, Mail, Handshake, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * "Act on this" — turns an insight (a recommendation, a competitive signal,
 * an analysis gap) into work in another area, carrying the insight text along
 * as prefilled context. Reuses the query-param prefill the campaign / email /
 * outreach creation flows already read, so the handoff lands in the right
 * creation flow instead of dropping the user on an empty form.
 */
export function ActOnThisMenu({
  context,
  label = "Act on this",
  variant = "outline",
  size = "sm",
  align = "end",
  className,
}: {
  /** The insight text carried into the target as prefilled context. */
  context: string;
  label?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "sm" | "default";
  align?: "start" | "end";
  className?: string;
}) {
  const [, navigate] = useLocation();
  const ctx = encodeURIComponent(context.trim().slice(0, 500));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className} data-testid="act-on-this">
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          {label}
          <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">Turn this into…</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => navigate(`/app/marketing/campaigns?recommendation=${ctx}`)} data-testid="act-campaign">
          <Megaphone className="w-4 h-4 mr-2" /> A campaign
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/app/marketing/email-newsletters?recommendation=${ctx}`)} data-testid="act-email">
          <Mail className="w-4 h-4 mr-2" /> An email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate(`/app/sales/outreach/new?goal=${ctx}`)} data-testid="act-outreach">
          <Handshake className="w-4 h-4 mr-2" /> Sales outreach
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
