"use client";

import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { isFolderNode, labelFor, type WikiNavNode } from "@/lib/page-tree";

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
  const isFolder = isFolderNode(node);

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

        {isFolder ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground min-w-0 flex-1 truncate text-start text-sm"
          >
            {labelFor(node)}
          </button>
        ) : node.page ? (
          <Link
            href={linkFor(node)}
            className="text-foreground hover:text-primary min-w-0 flex-1 truncate text-sm transition-colors duration-150"
            dir="auto"
          >
            {labelFor(node)}
          </Link>
        ) : (
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
            {labelFor(node)}
          </span>
        )}

        {renderActions ? (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
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
  /** Href for a leaf document's primary link. */
  linkFor: (node: WikiNavNode) => string;
  /** Optional secondary actions shown next to a node on hover (pages and folders). */
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
