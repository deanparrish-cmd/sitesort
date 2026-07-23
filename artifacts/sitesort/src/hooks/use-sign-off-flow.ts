import { useState } from "react";

export type SignOffTarget = { id: string; name: string; pinRequired: boolean } | null;

type Options = {
  hasPin: boolean;
  acknowledgeUrl: (documentId: string) => string;
  setPinUrl: string;
  authHeaders?: () => Record<string, string>;
  onSigned?: () => void;
  onPinSet?: () => void;
};

// Shared state machine behind every PIN sign-off surface (dashboard compliance
// page, portal "Shared with me"). Each surface renders its own UI — a modal
// dialog on dashboard, an inline card in the portal — but the PIN-entry /
// set-PIN-first-time / rate-limit-error logic is identical, so it lives here
// once. Mirrors the original inline flow in use-project-detail.tsx.
export function useSignOffFlow({ hasPin, acknowledgeUrl, setPinUrl, authHeaders, onSigned, onPinSet }: Options) {
  const headers = authHeaders ?? (() => ({ "Content-Type": "application/json" }));
  const [target, setTarget] = useState<SignOffTarget>(null);
  const [pin, setPin] = useState("");
  const [setPinMode, setSetPinMode] = useState(false);
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  // pinRequired defaults to true so any caller not yet passing the flag keeps
  // the strict PIN behaviour. When false, sign-off is a single deliberate
  // confirm ("I confirm I have read and understood") — no PIN entry at all.
  const open = (doc: { id: string; name: string; pinRequired?: boolean }) => {
    const pinRequired = doc.pinRequired ?? true;
    setError(null);
    setPin("");
    setPassword("");
    setNewPin("");
    setSetPinMode(pinRequired && !hasPin);
    setTarget({ id: doc.id, name: doc.name, pinRequired });
  };

  // "Forgot PIN?" — signed-in path: switch the dialog to set-a-new-PIN mode,
  // re-verified with the account password (server-side via setPinUrl). A user
  // locked out of the account entirely uses the emailed reset link instead.
  const forgotPin = () => {
    setError(null);
    setPin("");
    setSetPinMode(true);
  };

  const close = () => {
    setTarget(null);
    setError(null);
    setPin("");
    setPassword("");
    setNewPin("");
    setSetPinMode(false);
  };

  const submit = async () => {
    if (!target) return;
    setError(null);

    let pinToUse: string | null = null;
    if (!target.pinRequired) {
      // Confirm-only path — no PIN collected or sent.
    } else if (setPinMode) {
      if (!password) { setError("Enter your account password to set a PIN."); return; }
      if (!/^\d{4}$/.test(newPin)) { setError("PIN must be exactly 4 digits."); return; }
      pinToUse = newPin;
    } else {
      if (!/^\d{4}$/.test(pin)) { setError("Enter your 4-digit PIN."); return; }
      pinToUse = pin;
    }

    setSubmitting(true);
    try {
      if (target.pinRequired && setPinMode) {
        const pinRes = await fetch(setPinUrl, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ currentPassword: password, pin: newPin }),
        });
        const pinData = await pinRes.json().catch(() => ({}));
        if (!pinRes.ok) { setError(pinData.message ?? "Could not set your PIN."); setSubmitting(false); return; }
        onPinSet?.();
      }

      const res = await fetch(acknowledgeUrl(target.id), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(pinToUse ? { pin: pinToUse } : {}),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        onSigned?.();
        close();
        return;
      }

      if (res.status === 429) {
        setError(data.message ?? "Too many incorrect attempts. Please try again later.");
      } else if (data.error === "pin_not_set") {
        setSetPinMode(true);
        setError("Set a sign-off PIN to continue.");
      } else if (typeof data.attemptsRemaining === "number") {
        setError(`Incorrect PIN. ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} remaining.`);
        setPin("");
      } else {
        setError(data.message ?? "Could not sign off this document.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    target, open, close, forgotPin,
    pin, setPin,
    setPinMode,
    password, setPassword,
    newPin, setNewPin,
    submitting, error, submit,
    onlyDigits,
  };
}
