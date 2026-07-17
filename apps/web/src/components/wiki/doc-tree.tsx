"use client";

import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import type { WikiNavNode } from "@/lib/page-tree";

function nodeLabel(node: WikiNavNode): string {
  if (node.page) return node.page.title;
  return node.name.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());
}

function DocTreeNode({
  node,
  depth,
  linkFor,
  renderActions,
}: {
  node: WikiNavNode;
  depth: number;
  linkFor: (node: WikiNavNode) => string;
  renderActions?: (node: WikiNavNode) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const isFolder = node.children.length > 0;

  return (
    <li>
      <div
        className="group flex min-w-0 items-center gap-1.5 rounded-md py-1.5 pe-1"
        style={{ paddingInlineStart: `${depth * 1.25}rem` }}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded transition-colors duration-150"
          >
            <ChevronRightIcon
              className={`size-3.5 transition-transform duration-150 [transition-timing-function:var(--ease-out-spring)] ${open ? "rotate-90" : "rtl:rotate-180"}`}
            />
          </button>
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center">
            <FileTextIcon className="text-muted-foreground size-3.5 opacity-60" />
          </span>
        )}

        {node.page ? (
          <Link
            href={linkFor(node)}
            className="text-foreground hover:text-primary min-w-0 flex-1 truncate text-sm transition-colors duration-150"
            dir="auto"
          >
            {nodeLabel(node)}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground min-w-0 flex-1 truncate text-start text-sm"
          >
            {nodeLabel(node)}
          </button>
        )}

        {node.page && renderActions ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {renderActions(node)}
          </span>
        ) : null}
      </div>

      {isFolder && open ? (
        <ul>
          {node.children.map((child) => (
            <DocTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              linkFor={linkFor}
              renderActions={renderActions}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Folder/file tree over a bundle's docs — used for both raw pages and compiled OKF docs. */
export function DocTree({
  tree,
  linkFor,
  renderActions,
  emptyMessage,
}: {
  tree: WikiNavNode[];
  /** Href for a leaf node's primary link. */
  linkFor: (node: WikiNavNode) => string;
  /** Optional secondary action (e.g. an edit link) shown next to a leaf on hover. */
  renderActions?: (node: WikiNavNode) => ReactNode;
  emptyMessage: string;
}) {
  if (tree.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }
  return (
    <ul className="flex flex-col">
      {tree.map((node) => (
        <DocTreeNode key={node.path} node={node} depth={0} linkFor={linkFor} renderActions={renderActions} />
      ))}
    </ul>
  );
}
