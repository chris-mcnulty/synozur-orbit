import React from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FieldHelpProps {
  /**
   * Short explanation shown in the tooltip. Keep to 1-2 sentences.
   */
  content: React.ReactNode;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/**
 * Inline help icon with a tooltip. Place next to form field labels or section
 * headings to give users context without leaving the page. The underlying
 * button exposes the help text to screen readers via aria-label.
 */
export default function FieldHelp({
  content,
  className,
  side = "top",
  align = "center",
}: FieldHelpProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Help"
            data-testid="field-help-trigger"
            className={cn(
              "inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              className
            )}
            onClick={(e) => e.preventDefault()}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align={align}
          className="max-w-[260px] text-xs leading-relaxed whitespace-normal"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Convenience wrapper rendering a label with an inline help icon to its right.
 * Use when you want a one-line "Label + help" pattern.
 */
export function LabelWithHelp({
  htmlFor,
  children,
  help,
  className,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  help: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {children}
      </label>
      <FieldHelp content={help} />
    </div>
  );
}
