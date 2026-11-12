import { Children, isValidElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** Preserve button handlers and test IDs, with Radix roving focus and menu dismissal. */
export default function CampaignContactActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-stretch gap-1 p-1 [&>button]:justify-start">{Children.map(children, child => {
    if (!isValidElement<{ disabled?: boolean; hidden?: boolean }>(child) || child.type !== Button) return child;
    if (child.props.hidden) return null;
    return <DropdownMenuItem asChild disabled={child.props.disabled}>{child}</DropdownMenuItem>;
  })}</div>;
}
