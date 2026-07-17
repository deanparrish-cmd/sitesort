import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDetail } from "../context";

export function CloseoutDialog() {
  const {
    project,
    onlyDigits,
    closeoutOpen,
    setCloseoutOpen,
    closeoutPin,
    setCloseoutPin,
    closeoutNote,
    setCloseoutNote,
    closeoutSetPinMode,
    closeoutSetPinPassword,
    setCloseoutSetPinPassword,
    closeoutSetPinValue,
    setCloseoutSetPinValue,
    closeoutSubmitting,
    closeoutError,
    setCloseoutError,
    submitCloseout,
  } = useDetail();

  return (
    <>
      {/* F2 — close-out PIN sign-off dialog */}
      <Dialog open={closeoutOpen} onOpenChange={v => { if (!v) { setCloseoutOpen(false); setCloseoutError(null); } }}>
        <DialogHeader>
          <DialogTitle>Sign off &amp; close out project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This marks the project <span className="font-medium text-foreground">Complete</span> and records a timestamped handover with your name. Confirm with your sign-off PIN.
          </p>
          {closeoutSetPinMode ? (
            <>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                You don't have a sign-off PIN yet. Set one now to confirm close-outs and document sign-offs.
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Account password</label>
                <Input type="password" value={closeoutSetPinPassword} onChange={e => setCloseoutSetPinPassword(e.target.value)} placeholder="Your account password" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">New 4-digit PIN</label>
                <Input type="password" inputMode="numeric" value={closeoutSetPinValue} onChange={e => setCloseoutSetPinValue(onlyDigits(e.target.value))} placeholder="••••" />
              </div>
            </>
          ) : (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Sign-off PIN</label>
              <Input
                type="password"
                inputMode="numeric"
                autoFocus
                value={closeoutPin}
                onChange={e => setCloseoutPin(onlyDigits(e.target.value))}
                onKeyDown={e => { if (e.key === "Enter") submitCloseout(); }}
                placeholder="••••"
              />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">Handover note (optional)</label>
            <Textarea value={closeoutNote} onChange={e => setCloseoutNote(e.target.value)} placeholder="e.g. Snagging complete, keys handed to client." rows={2} />
          </div>
          {closeoutError && <p className="text-destructive text-sm">{closeoutError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCloseoutOpen(false); setCloseoutError(null); }}>Cancel</Button>
          <Button variant="accent" onClick={submitCloseout} isLoading={closeoutSubmitting}>Confirm close-out</Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
