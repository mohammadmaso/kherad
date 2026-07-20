"use client";

import { Button } from "@kherad/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kherad/ui/components/ui/dropdown-menu";
import { Input } from "@kherad/ui/components/ui/input";
import { Label } from "@kherad/ui/components/ui/label";
import { resolveCreatePagePath } from "@kherad/core/page-paths";
import { childFolderNames } from "@/lib/page-tree";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon } from "lucide-react";

type PagePathFieldsProps = {
  folder: string;
  onFolderChange: (folder: string) => void;
  path: string;
  onPathChange: (path: string) => void;
  title: string;
  existingFolders: string[];
  labels: {
    pathFolderLabel: string;
    pathFolderPlaceholder: string;
    pathFolderHint: string;
    pathDocLabel: string;
    pathDocPlaceholder: string;
    pathParentRoot: string;
    pathCreatesPrefix: string;
    pathAddSubfolder: string;
  };
};

function joinFolder(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * Folder + document path fields. Folder picker is per directory level;
 * blank document name falls back to the title slug.
 */
export function PagePathFields({
  folder,
  onFolderChange,
  path,
  onPathChange,
  title,
  existingFolders,
  labels,
}: PagePathFieldsProps) {
  const segments = folder.trim() ? folder.trim().replace(/^\/+|\/+$/g, "").split("/") : [];
  const canPreview = Boolean(title.trim() || path.trim() || folder.trim());
  const previewPath = canPreview
    ? resolveCreatePagePath({
        folder,
        path,
        title: title.trim() || "document",
      })
    : null;

  const nextLevelChildren = childFolderNames(existingFolders, folder.trim());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{labels.pathFolderLabel}</Label>
        <div className="border-input bg-background shadow-xs flex min-h-9 flex-wrap items-center gap-0.5 rounded-lg border px-1.5 py-1">
          <FolderSegmentMenu
            label={labels.pathParentRoot}
            selected={!segments.length}
            options={childFolderNames(existingFolders, "")}
            onPick={(name) => onFolderChange(name ?? "")}
            includeRoot
            rootLabel={labels.pathParentRoot}
          />

          {segments.map((segment, index) => {
            const parentPath = segments.slice(0, index).join("/");
            const currentPath = segments.slice(0, index + 1).join("/");
            const siblings = childFolderNames(existingFolders, parentPath);
            return (
              <div key={`${currentPath}-${index}`} className="flex items-center gap-0.5">
                <ChevronRightIcon className="text-muted-foreground size-3 shrink-0 opacity-50" />
                <FolderSegmentMenu
                  label={segment}
                  selected
                  options={siblings.length > 0 ? siblings : [segment]}
                  onPick={(name) => {
                    if (!name) {
                      onFolderChange(parentPath);
                      return;
                    }
                    onFolderChange(parentPath ? `${parentPath}/${name}` : name);
                  }}
                />
              </div>
            );
          })}

          {nextLevelChildren.length > 0 ? (
            <div className="flex items-center gap-0.5">
              <ChevronRightIcon className="text-muted-foreground size-3 shrink-0 opacity-50" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground font-mono"
                    >
                      {labels.pathAddSubfolder}
                      <ChevronDownIcon className="size-3 opacity-60" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
                  {nextLevelChildren.map((name) => (
                    <DropdownMenuItem
                      key={name}
                      onClick={() => onFolderChange(joinFolder(folder.trim(), name))}
                      className="gap-2 font-mono text-xs"
                    >
                      <FolderIcon className="size-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>

        <Input
          id="page-path-folder"
          value={folder}
          onChange={(e) => onFolderChange(e.target.value)}
          placeholder={labels.pathFolderPlaceholder}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          className="font-mono"
        />
        <p className="text-muted-foreground text-xs leading-relaxed">{labels.pathFolderHint}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="page-path-doc">{labels.pathDocLabel}</Label>
        <Input
          id="page-path-doc"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder={labels.pathDocPlaceholder}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          className="font-mono"
        />
        {previewPath ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {labels.pathCreatesPrefix}{" "}
            <span className="text-foreground/80 font-mono">/{previewPath}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FolderSegmentMenu({
  label,
  selected,
  options,
  onPick,
  includeRoot = false,
  rootLabel,
}: {
  label: string;
  selected: boolean;
  options: string[];
  /** `null` means root / clear this level's parent path. */
  onPick: (name: string | null) => void;
  includeRoot?: boolean;
  rootLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={`max-w-[10rem] font-mono ${selected ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span className="truncate">{label}</span>
            <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-64 w-56 overflow-y-auto">
        {includeRoot ? (
          <>
            <DropdownMenuItem onClick={() => onPick(null)} className="gap-2">
              <FolderIcon className="size-3.5 shrink-0 opacity-60" />
              <span className="flex-1 truncate">{rootLabel}</span>
              {selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
            </DropdownMenuItem>
            {options.length > 0 ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {options.map((name) => (
          <DropdownMenuItem
            key={name}
            onClick={() => onPick(name)}
            className="gap-2 font-mono text-xs"
          >
            <FolderIcon className="size-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {label === name ? <CheckIcon className="size-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
