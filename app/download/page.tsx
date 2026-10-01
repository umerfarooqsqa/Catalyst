import type { Metadata } from "next";
import DownloadButton from "./DownloadButton";
import app from "@/lib/android-app.json";

export const metadata: Metadata = { title: "Get the Catalyst Android app" };

/**
 * Public page (no sign-in needed, see PUBLIC_PATHS) for installing the Android app:
 * the signed APK built by android-app/build.ps1, which also refreshes
 * lib/android-app.json and public/downloads/catalyst-android.apk.
 */
export default function DownloadPage() {
  const sizeMb = (app.sizeBytes / (1024 * 1024)).toFixed(1);
  return (
    <div className="flex min-h-screen items-center justify-center bg-grid-head px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img src="/brand/logo-mark.png" alt="Catalyst" className="mx-auto mb-3 h-16 w-16 object-contain" />
          <h1 className="text-lg font-semibold text-slate-900">Catalyst for Android</h1>
          <p className="text-sm text-slate-500">
            Bugs, your queue and notifications, as an app on your phone.
          </p>
        </div>

        <div className="rounded-md border border-grid-line bg-white p-5 shadow-card">
          <DownloadButton href={app.url} version={app.version} sizeMb={sizeMb} />

          <h2 className="mt-6 text-sm font-semibold text-slate-700">Installing it</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Tap <b>Download for Android</b> above. If Chrome asks, keep the file.</li>
            <li>
              Open the downloaded file. The first time, Android asks you to allow installs from Chrome: tap{" "}
              <b>Settings</b>, turn on <b>Allow from this source</b>, then go back.
            </li>
            <li>Tap <b>Install</b>, then <b>Open</b>. Sign in once and you stay signed in.</li>
          </ol>
          <p className="mt-4 text-xs text-slate-400">
            Updates to the portal reach the app by themselves, so you only reinstall when a new version is announced
            here. If you added Catalyst to your home screen from Chrome before, you can remove that shortcut.
          </p>
          <p className="mt-3 break-all text-[11px] text-slate-400">
            Version {app.version} · {sizeMb} MB · SHA-256 {app.sha256}
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Opening this on a computer? Visit this page on your Android phone instead.{" "}
          <a href="/dashboard" className="text-brand-fg hover:underline">Back to Catalyst</a>
        </p>
      </div>
    </div>
  );
}
