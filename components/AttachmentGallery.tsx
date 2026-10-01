"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Attachment = {
  id: string;
  file_name: string;
  file_path: string;
  file_size_bytes: number | null;
  created_at: string;
};

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const LINK_TTL = 60 * 60; // seconds: the signed links outlive a long look at the bug

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * A bug's attachments: screenshots as thumbnails that open full size in the page,
 * other files as download links.
 *
 * The bucket is private, so every file needs a signed URL. They are fetched up front
 * in one call, so a tap never waits for a network request and then opens a new window:
 * browsers (the installed app especially) block that as a pop-up.
 */
export default function AttachmentGallery({ attachments }: { attachments: Attachment[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Attachment | null>(null);

  useEffect(() => {
    if (attachments.length === 0) return;
    let live = true;
    createClient()
      .storage.from("attachments")
      .createSignedUrls(
        attachments.map((a) => a.file_path),
        LINK_TTL,
      )
      .then(({ data, error }) => {
        if (!live) return;
        if (error || !data) {
          setFailed(true);
          return;
        }
        const map: Record<string, string> = {};
        for (const d of data) if (d.path && d.signedUrl) map[d.path] = d.signedUrl;
        setUrls(map);
      });
    return () => {
      live = false;
    };
  }, [attachments]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (attachments.length === 0) return <p className="text-sm text-slate-400">None</p>;

  const images = attachments.filter((a) => IMAGE.test(a.file_name));
  const files = attachments.filter((a) => !IMAGE.test(a.file_name));

  return (
    <>
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a) => {
            const url = urls[a.file_path];
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => url && setOpen(a)}
                  disabled={!url}
                  title={a.file_name}
                  className="group block w-full overflow-hidden rounded-md border border-grid-line bg-slate-50 text-left"
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={a.file_name}
                      loading="lazy"
                      className="h-36 w-full object-cover object-top transition group-hover:opacity-90"
                    />
                  ) : (
                    <div className="flex h-36 items-center justify-center text-xs text-slate-400">
                      {failed ? "Couldn't load" : "Loading…"}
                    </div>
                  )}
                  <div className="truncate border-t border-grid-line bg-white px-2 py-1 text-[11px] text-slate-500">
                    {a.file_name} {a.file_size_bytes ? `· ${size(a.file_size_bytes)}` : ""}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((a) => (
            <li key={a.id} className="text-sm">
              {urls[a.file_path] ? (
                <a href={urls[a.file_path]} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  {a.file_name}
                </a>
              ) : (
                <span className="text-slate-500">{a.file_name}</span>
              )}
              <span className="ml-2 text-xs text-slate-400">{size(a.file_size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}

      {failed && <p className="mt-2 text-xs text-red-600">The attachments couldn&apos;t be loaded. Close and reopen the bug to retry.</p>}

      {open && urls[open.file_path] && (
        <div
          role="dialog"
          aria-label={open.file_name}
          className="fixed inset-0 z-[60] flex flex-col bg-slate-950/90"
          onClick={() => setOpen(null)}
        >
          <div className="flex items-center gap-3 px-4 py-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 flex-1 truncate">{open.file_name}</span>
            <a
              href={urls[open.file_path]}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-white/30 px-2.5 py-1 text-xs hover:bg-white/10"
            >
              Open original
            </a>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Close"
              className="rounded-md px-2 py-1 text-lg leading-none hover:bg-white/10"
            >
              ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urls[open.file_path]}
              alt={open.file_name}
              className="max-h-full max-w-full rounded object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
}
