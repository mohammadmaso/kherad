"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { DRAG_DROP_PASTE } from "@lexical/rich-text";
import { isMimeType, mergeRegister } from "@lexical/utils";
import {
  $insertNodes,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";
import { useEffect, useRef, useState, type JSX } from "react";

import { uploadBundleAsset } from "@/lib/api-client";

import { $createImageNode } from "../nodes/image-node";

/** Opens the file picker; dispatched by the toolbar button and the slash menu. */
export const INSERT_IMAGE_UPLOAD_COMMAND: LexicalCommand<undefined> = createCommand(
  "INSERT_IMAGE_UPLOAD_COMMAND",
);

const IMAGE_MIME_TYPES = ["image/"];

async function uploadAndInsert(editor: LexicalEditor, bundleId: string, files: File[]) {
  for (const file of files) {
    if (!isMimeType(file, IMAGE_MIME_TYPES)) continue;
    const { src } = await uploadBundleAsset(bundleId, file);
    const altText = file.name.replace(/\.[^.]+$/, "");
    editor.update(() => {
      $insertNodes([$createImageNode(src, altText)]);
    });
  }
}

/**
 * Image support: uploads picked/pasted/dropped image files to the bundle's
 * git subtree via the API, then inserts an ImageNode pointing at the served
 * asset URL. Disabled (renders nothing) when the editor has no bundle
 * context, e.g. the conflict-resolution editor.
 */
export function ImagesPlugin({ bundleId }: { bundleId: string }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_IMAGE_UPLOAD_COMMAND,
        () => {
          inputRef.current?.click();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DRAG_DROP_PASTE,
        (files) => {
          const images = files.filter((file) => isMimeType(file, IMAGE_MIME_TYPES));
          if (images.length === 0) return false;
          setError(null);
          uploadAndInsert(editor, bundleId, images).catch((err) => {
            setError(err instanceof Error ? err.message : "Image upload failed");
          });
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, bundleId]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/avif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length === 0) return;
          setError(null);
          uploadAndInsert(editor, bundleId, files).catch((err) => {
            setError(err instanceof Error ? err.message : "Image upload failed");
          });
        }}
      />
      {error ? (
        <p role="alert" className="text-destructive px-1 text-xs">
          {error}
        </p>
      ) : null}
    </>
  );
}
