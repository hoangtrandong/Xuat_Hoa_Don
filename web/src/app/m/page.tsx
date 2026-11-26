import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import MobileOrderWorkspace from "@/components/mobile/MobileOrderWorkspace";

export default function MobileOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center p-8 text-slate-500">
          <Loader2 size={24} className="animate-spin text-sky-600" />
        </div>
      }
    >
      <MobileOrderWorkspace />
    </Suspense>
  );
}
