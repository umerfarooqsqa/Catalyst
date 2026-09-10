export default function Loading() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-sm border border-grid-line bg-grid-head/40"
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-sm border border-grid-line bg-grid-head/30" />
        <div className="h-56 rounded-sm border border-grid-line bg-grid-head/30" />
      </div>
    </div>
  );
}
