import { useSignOffFlow } from "@/hooks/use-sign-off-flow";

// Inline (no modal) PIN entry for a portal sign-off — mobile-first, matches the
// rest of the portal's "expand in place" pattern (e.g. AddPlantItemForm) rather
// than the dashboard's dialog-based flow.
export function SignOffPinCard({ flow, actionLabel = "Sign off", busyLabel = "Signing off…" }: {
  flow: ReturnType<typeof useSignOffFlow>; actionLabel?: string; busyLabel?: string;
}) {
  if (!flow.target) return null;
  return (
    <div className="bg-card border border-primary/30 bg-primary/5 rounded-2xl p-5">
      {!flow.target.pinRequired ? (
        <p className="text-sm text-muted-foreground">
          By signing off you confirm: <span className="font-medium text-foreground">"I confirm I have read and understood this document."</span> Your name and the time will be recorded.
        </p>
      ) : flow.setPinMode ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Set a 4-digit sign-off PIN to continue. You'll use it to confirm future sign-offs.</p>
          <div>
            <label className="text-sm font-bold text-muted-foreground">Account password</label>
            <input
              type="password" autoComplete="current-password" value={flow.password} onChange={e => flow.setPassword(e.target.value)}
              placeholder="Confirm it's you"
              className="mt-1 w-full min-h-14 rounded-xl border-2 border-border bg-background px-4 text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-muted-foreground">Choose a 4-digit PIN</label>
            <input
              type="password" inputMode="numeric" value={flow.newPin} onChange={e => flow.setNewPin(flow.onlyDigits(e.target.value))}
              placeholder="••••"
              className="mt-1 w-full min-h-14 rounded-xl border-2 border-border bg-background px-4 text-xl font-bold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="text-sm font-bold text-muted-foreground">Enter your 4-digit PIN</label>
          <input
            type="password" inputMode="numeric" autoFocus value={flow.pin}
            onChange={e => flow.setPin(flow.onlyDigits(e.target.value))}
            onKeyDown={e => { if (e.key === "Enter") void flow.submit(); }}
            placeholder="••••"
            className="mt-1 w-full min-h-14 rounded-xl border-2 border-border bg-background px-4 text-xl font-bold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={flow.forgotPin}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Forgot your PIN? Reset it with your password
          </button>
        </div>
      )}
      {flow.error && <p className="mt-2 text-xs text-destructive">{flow.error}</p>}
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => void flow.submit()}
          disabled={flow.submitting}
          className="flex-1 min-h-14 rounded-xl bg-primary text-primary-foreground text-base font-bold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {flow.submitting ? busyLabel : !flow.target.pinRequired ? `Confirm & ${actionLabel.toLowerCase()}` : flow.setPinMode ? `Set PIN & ${actionLabel.toLowerCase()}` : actionLabel}
        </button>
        <button onClick={flow.close} className="min-h-14 px-5 rounded-xl border-2 border-border text-base font-bold hover:bg-muted active:scale-[0.98] transition-all">Cancel</button>
      </div>
    </div>
  );
}
