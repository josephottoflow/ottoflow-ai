import { CreditCard, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function BillingPage() {
  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Billing</h1>
          <p className="text-white/40 text-sm mt-1">Manage your plan and usage</p>
        </div>
        <Badge variant="purple" className="text-2xs">Coming soon</Badge>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(233,134,59,0.2), rgba(194,90,30,0.1))",
                color: "#F2A863",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Pro Plan</h2>
              <p className="text-xs text-white/40">Current plan</p>
            </div>
          </div>
          <div className="space-y-2 text-sm text-white/60 mb-5">
            <div className="flex justify-between">
              <span>Brand research engine</span>
              <span className="text-emerald-400">Included</span>
            </div>
            <div className="flex justify-between">
              <span>Content strategy</span>
              <span className="text-white/30">Coming soon</span>
            </div>
            <div className="flex justify-between">
              <span>Video generation</span>
              <span className="text-white/30">Coming soon</span>
            </div>
            <div className="flex justify-between">
              <span>Monthly credits</span>
              <span>5,000</span>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" disabled>
            Manage Plan
          </Button>
        </div>

        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(59,130,246,0.1))",
                color: "#67e8f9",
              }}
            >
              <CreditCard size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Payment Method</h2>
              <p className="text-xs text-white/40">Billing card on file</p>
            </div>
          </div>
          <div className="text-sm text-white/40 py-8 text-center">
            No payment method connected yet.
          </div>
          <Button variant="outline" size="sm" className="w-full" disabled>
            Add Card
          </Button>
        </div>
      </div>

      <p className="text-xs text-white/30 mt-6 text-center">
        Billing integration is in development. Get in touch with sales for early-access pricing.
      </p>
    </div>
  );
}
