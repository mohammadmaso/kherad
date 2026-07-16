"use client";

import { cn } from "@kherad/ui/lib/utils";
import { Loader2Icon } from "lucide-react";

export function Loader({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn("text-muted-foreground inline-flex items-center gap-2 text-sm", className)}>
      <Loader2Icon className="size-3.5 animate-spin motion-reduce:animate-none" />
      {label}
    </span>
  );
}
