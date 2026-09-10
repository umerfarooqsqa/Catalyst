export function SheetSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-6 w-32 rounded bg-grid-head" />
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded bg-grid-head" />
          <div className="h-8 w-24 rounded bg-grid-head" />
        </div>
      </div>
      <div className="mb-2 flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-7 w-24 rounded bg-grid-head" />
        ))}
      </div>
      <div className="overflow-hidden rounded-sm border border-grid-line">
        <div className="h-9 border-b border-grid-line bg-grid-head" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex h-9 items-center gap-4 border-b border-grid-line px-3"
          >
            <div className="h-3 w-4 rounded bg-grid-head" />
            <div className="h-3 flex-[3] rounded bg-grid-head" />
            <div className="h-3 flex-1 rounded bg-grid-head" />
            <div className="h-3 flex-1 rounded bg-grid-head" />
            <div className="h-3 flex-1 rounded bg-grid-head" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded bg-grid-head" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-sm border border-grid-line bg-grid-head/40" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-sm border border-grid-line bg-grid-head/30" />
        <div className="h-56 rounded-sm border border-grid-line bg-grid-head/30" />
      </div>
    </div>
  );
}
