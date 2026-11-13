import { PAGE_CONTAINER } from "./page-container";

// Shown inside the persistent shell while a page's server render is pending.
export default function ProtectedLoading() {
  return (
    <div className={`${PAGE_CONTAINER} space-y-4 p-4`} role="status" aria-label="Loading">
      <div className="skeleton h-10 w-[30%] max-lg:w-1/2" />
      <div className="skeleton h-[120px] w-full" />
      <div className="skeleton h-[120px] w-[80%]" />
      <div className="skeleton h-[120px] w-[60%]" />
    </div>
  );
}
