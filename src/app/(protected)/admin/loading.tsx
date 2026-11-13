// The admin shell already renders the nav tree, so this is content-only:
// a title bar plus table-like rows.
export default function AdminLoading() {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      <div className="skeleton h-8 w-1/3 max-lg:w-1/2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skeleton h-10 w-full" />
      ))}
    </div>
  );
}
