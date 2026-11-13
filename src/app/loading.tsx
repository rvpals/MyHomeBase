// Initial app load, before the protected layout mounts. Server component.
export default function RootLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "var(--paper, #0f1117)" }}
      role="status"
      aria-label="Loading"
    >
      <div className="loading-spinner" />
    </div>
  );
}
