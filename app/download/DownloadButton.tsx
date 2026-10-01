"use client";

import { useAppContext } from "@/components/AndroidAppButton";

/** The big download button; inside the installed app it says so instead. */
export default function DownloadButton({ href, version, sizeMb }: { href: string; version: string; sizeMb: string }) {
  const { ready, android, inApp, installed } = useAppContext();
  if (ready && (inApp || installed)) {
    return (
      <p className="rounded-md bg-brand-soft px-3 py-2.5 text-center text-sm font-medium text-brand-fg">
        ✓ The Catalyst app is {inApp ? "open" : "installed on this phone"}.
        {installed && !inApp ? " Open it from your home screen." : ""}
      </p>
    );
  }
  return (
    <>
      <a
        href={href}
        download="Catalyst.apk"
        className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.98] hover:bg-brand-fg"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M8 1.5v8m0 0 3-3m-3 3-3-3M2.5 11v2A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5v-2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Download for Android
      </a>
      <p className="mt-2 text-center text-xs text-slate-500">
        Version {version} · {sizeMb} MB{ready && !android ? " · for Android phones" : ""}
      </p>
    </>
  );
}
