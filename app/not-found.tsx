import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="mt-1 text-lg font-semibold text-slate-900">
        Page not found
      </h1>
      <p className="mt-1 text-[13px] text-slate-500">
        That page doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link
        href="/dashboard"
        className="mt-4 rounded-sm bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:bg-brand-fg"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
