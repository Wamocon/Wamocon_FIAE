export default function Loading() {
  return (
    <div className="animate-pulse min-h-full p-4 md:p-6 lg:p-8 space-y-6">
      <div className="h-8 w-48 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="flex gap-4">
        <div className="h-10 w-52 rounded-xl bg-gray-200 dark:bg-gray-700" />
        <div className="h-10 w-32 rounded-xl bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="h-8 w-8 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-6 w-40 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-8 w-8 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="grid grid-cols-7 gap-px rounded-2xl border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
        {[...Array(35)].map((_, i) => (
          <div key={i} className="min-h-[80px] p-2 border-b border-r border-gray-100 dark:border-gray-700">
            <div className="h-5 w-5 rounded-full bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
