"use client";

import { Button } from "@kherad/ui/components/ui/button";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

export function CopyMarkdownButton({
  markdown,
  label,
  copiedLabel,
}: {
  markdown: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
