import { Skeleton } from "@aibos/ui";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1680px]" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-7 w-64" />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[172px] rounded-2xl" />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Skeleton className="h-72 rounded-2xl xl:col-span-8" />
        <Skeleton className="h-72 rounded-2xl xl:col-span-4" />
      </div>
    </div>
  );
}
