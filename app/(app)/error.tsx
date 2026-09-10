"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-slate-900">
        Something went wrong
      </h1>
      <p className="mt-1 text-[13px] text-slate-500">
        {error.message || "An unexpected error occurred while loading this page."}
        {error.digest ? (
          <span className="mt-1 block text-xs text-slate-400">
            Reference: {error.digest}
          </span>
        ) : null}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => (window.location.href = "/dashboard")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
