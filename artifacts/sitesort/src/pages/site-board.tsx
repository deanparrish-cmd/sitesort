import { useEffect, useRef, useState } from "react";
import { fmtSiteTimeLabelled } from "@/lib/site-time";
import { useRoute } from "wouter";
import { MapPin, Calendar, FileText, HardHat, ShieldCheck, AlertTriangle, Users, Mail, Phone, Clock, Camera, CheckCircle2, Loader2, Pin, XCircle, Building2 } from "lucide-react";
import { openDocument } from "@/lib/documents";

// See the onSiteCount comment in SiteBoard: off until stale check-ins stop counting.
const SHOW_PUBLIC_ON_SITE_COUNT = false;

async function stampPhoto(file: File, projectName: string, workerName: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const barH = Math.max(64, img.naturalHeight * 0.12);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, img.naturalHeight - barH, img.naturalWidth, barH);

      const fontSize = Math.max(14, Math.floor(barH * 0.28));
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";

      const pad = Math.floor(barH * 0.12);
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

      ctx.fillText(`${workerName}  ·  ${dateStr} ${timeStr}`, pad, img.naturalHeight - barH + pad);
      ctx.font = `${Math.floor(fontSize * 0.8)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(projectName, pad, img.naturalHeight - barH + pad + fontSize + 4);

      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/jpeg", 0.88);
    };
    img.onerror = reject;
    img.src = url;
  });
}

const TYPE_LABELS: Record<string, string> = {
  drawing: "Drawing",
  method_statement: "RAMS",
  permit: "Permit",
  safety: "Safety Document",
  general: "General",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: "Active", color: "bg-green-100 text-green-800" },
    on_hold: { label: "On Hold", color: "bg-amber-100 text-amber-800" },
    complete: { label: "Complete", color: "bg-blue-100 text-blue-800" },
  };
  const s = map[status] ?? { label: status, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${s.color}`}>
      {s.label}
    </span>
  );
}

interface SiteManager {
  name: string;
  email: string;
  phone: string | null;
}

// Phone-first check-in (#124). The mobile number is the key: a number on file
// for someone on this project identifies them ("Is this you?"). An unknown
// number still gets a sign-in, but it waits at the gate for the site manager
// (name, company and the number are passed on, and the number is filed when
// they're let on). Nobody can look up names, list the roster or pick a company
// from a list any more.
const inputCls = "w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-orange-400 min-w-0";
const labelCls = "block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wider";

function CheckInCard({
  token,
  projectName,
  siteManager,
  onCheckedIn,
}: {
  token: string;
  projectName: string;
  siteManager: SiteManager | null;
  onCheckedIn: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  // phone: ask for the number. confirm: "Is this you?". details: number not on
  // file, so name + company. ready: identity settled, take the photo.
  const [step, setStep] = useState<"phone" | "confirm" | "details" | "ready">("phone");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  type Match = { label: string; matchToken: string };
  const [matches, setMatches] = useState<Match[]>([]);
  const [confirmed, setConfirmed] = useState<Match | null>(null);
  const [looking, setLooking] = useState(false);
  // The board has paused number lookups (someone tried too many wrong ones):
  // everyone gives name + company and waits for the site manager meanwhile.
  const [checkingPaused, setCheckingPaused] = useState(false);
  const [status, setStatus] = useState<"idle" | "capturing" | "uploading" | "done">("idle");
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [hold, setHold] = useState<{ token: string; reason: string; status: "pending" | "approved" | "refused" | "lapsed" } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  // Sign-out state: `signedIn` is set when the server says this person is
  // currently on site (offer SIGN OUT); `signedOutAt` shows the confirmation.
  const [signedIn, setSignedIn] = useState<{ checkedInAt: string; checkinId?: string } | null>(null);
  const [signedOutAt, setSignedOutAt] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signedOutLabel, setSignedOutLabel] = useState("");
  const [signOutMode, setSignOutMode] = useState(false);
  // Remembered device: server-verified token, per project.
  const [device, setDevice] = useState<{ workerName: string; companyName: string } | null>(null);
  const [useDevice, setUseDevice] = useState(false);
  const deviceKey = `sitesort_site_device_${token}`;

  // Storage can be unavailable (private mode, blocked site data): never throw.
  const readDeviceToken = (): string | null => { try { return localStorage.getItem(deviceKey); } catch { return null; } };
  const writeDeviceToken = (v: string | null) => { try { if (v) localStorage.setItem(deviceKey, v); else localStorage.removeItem(deviceKey); } catch { /* fall back to the number */ } };

  useEffect(() => {
    if (!hold || hold.status !== "pending") return;
    const t = setInterval(() => {
      fetch(`/api/site/${token}/hold?holdToken=${encodeURIComponent(hold.token)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d || d.status === "pending") return;
          if (d.status === "approved" && d.deviceToken) writeDeviceToken(d.deviceToken);
          setHold(h => h ? { ...h, status: d.status } : h);
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold, token]);

  // On scan: if this device remembers someone, offer one tap sign-in/out for them.
  useEffect(() => {
    const t = readDeviceToken();
    if (!t) return;
    fetch(`/api/site/${token}/device?deviceToken=${encodeURIComponent(t)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.valid) { writeDeviceToken(null); return; }
        setDevice({ workerName: d.workerName, companyName: d.companyName });
        if (d.onSite) setSignedIn({ checkedInAt: d.checkedInAt, checkinId: d.checkinId });
      })
      .catch(() => { /* offline: normal form */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const digits = (v: string) => v.replace(/\D/g, "");
  const lookUp = async () => {
    if (digits(phone).length < 9) { setErrorMsg("Enter your mobile number."); return; }
    setLooking(true); setErrorMsg("");
    try {
      const r = await fetch(`/api/site/${token}/identify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErrorMsg(d.message ?? "Something went wrong. Please try again."); return; }
      const found: Match[] = d.matches ?? [];
      setCheckingPaused(!!d.checkingPaused);
      setMatches(found);
      if (found.length > 0) setStep("confirm");
      else setStep("details");
    } catch {
      setErrorMsg("No connection. Please try again.");
    } finally { setLooking(false); }
  };

  const doSignOut = async () => {
    // A remembered device proves who this is; otherwise the mobile number does.
    const deviceToken = readDeviceToken();
    if (!deviceToken && digits(phone).length < 9) { setErrorMsg("Enter your mobile number to sign out."); return; }
    setSigningOut(true);
    setErrorMsg("");
    try {
      const r = await fetch(`/api/site/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deviceToken ? { deviceToken } : { phone: phone.trim() }),
      });
      if (r.status === 409) {
        setSignedIn(null);
        setErrorMsg("We could not find an open sign-in to close. If you are still on site, ask your site manager.");
        return;
      }
      if (r.status === 403 || r.status === 400 || r.status === 429) {
        const d = await r.json().catch(() => ({}));
        setErrorMsg(d.message ?? "We couldn't confirm it's you. Ask your site manager to sign you out.");
        return;
      }
      if (!r.ok) throw new Error("failed");
      const d = await r.json();
      setSignedIn(null);
      setSignOutMode(false);
      setPhone("");
      setSignedOutLabel(d.workerName ?? device?.workerName ?? "You");
      setSignedOutAt(d.checkedOutAt);
    } catch {
      setErrorMsg("Sign-out failed. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  const reset = () => {
    setStep("phone");
    setName("");
    setCompanyName("");
    setMatches([]);
    setConfirmed(null);
    setUseDevice(false);
    setStatus("idle");
    setPreview(null);
    setCapturedFile(null);
    setErrorMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const notMe = () => {
    writeDeviceToken(null);
    setDevice(null);
    setSignedIn(null);
    setSignedOutAt(null);
    reset();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturedFile(file);
    setPreview(URL.createObjectURL(file));
    setStatus("capturing");
  };

  // Who the photo is stamped with, before the server confirms.
  const stampName = useDevice && device ? device.workerName : confirmed ? confirmed.label.split(",")[0] : name.trim();

  const handleCheckin = async () => {
    if (!capturedFile) { fileRef.current?.click(); return; }
    setStatus("uploading");
    setErrorMsg("");
    try {
      let lat: number | null = null, lng: number | null = null;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* GPS optional */ }

      const stamped = await stampPhoto(capturedFile, projectName, stampName);
      const fd = new FormData();
      fd.append("photo", stamped, "checkin.jpg");
      const deviceToken = useDevice ? readDeviceToken() : null;
      if (deviceToken) fd.append("deviceToken", deviceToken);
      else if (confirmed) fd.append("matchToken", confirmed.matchToken);
      else {
        fd.append("phone", phone.trim());
        fd.append("workerName", name.trim());
        fd.append("companyName", companyName.trim());
      }
      if (lat !== null) fd.append("lat", String(lat));
      if (lng !== null) fd.append("lng", String(lng));

      const res = await fetch(`/api/site/${token}/checkin`, { method: "POST", body: fd });

      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "check_in_held" && body.holdToken) {
          setHold({ token: body.holdToken, reason: body.holdReason ?? "insurance_none", status: "pending" });
          setStatus("idle");
          return;
        }
        // The remembered device or the "Is this you?" tap no longer holds: start again with the number.
        if (useDevice) { writeDeviceToken(null); setDevice(null); }
        reset();
        setErrorMsg(body.message ?? "We couldn't confirm it's you. Enter your mobile number.");
        return;
      }
      if (res.status === 409) {
        // Already signed in: offer SIGN OUT instead of a second sign-in.
        const body = await res.json().catch(() => ({}));
        setSignedIn({ checkedInAt: body.checkedInAt, checkinId: body.checkinId });
        setStatus("idle");
        setPreview(null);
        setCapturedFile(null);
        return;
      }
      if (res.status === 400 || res.status === 429) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.message ?? "Please check your details.");
        setStatus("capturing");
        return;
      }
      if (!res.ok) throw new Error("Upload failed");

      const created = await res.json().catch(() => null);
      if (created?.deviceToken) writeDeviceToken(created.deviceToken);
      if (created?.checkedInAt) setDoneAt(fmtSiteTimeLabelled(created.checkedInAt, created.siteTimeZone));
      setStatus("done");
      setTimeout(() => onCheckedIn(), 2000);
    } catch {
      setErrorMsg("Check-in failed. Please try again.");
      setStatus("capturing");
    }
  };

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const who = device ? `${device.workerName} (${device.companyName})` : "You";

  if (signedOutAt) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-6 text-center space-y-4">
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
        <h3 className="text-xl font-bold text-gray-900">Signed out</h3>
        <p className="text-gray-500 text-sm break-words">{signedOutLabel}, you signed out at {hhmm(signedOutAt)}. Scan again to sign back in.</p>
        <button
          onClick={() => { setSignedOutAt(null); reset(); }}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl min-h-11"
          data-testid="button-sign-back-in"
        >
          Sign back in
        </button>
      </div>
    );
  }

  if (signedIn) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="bg-gradient-to-r from-green-700 to-green-500 px-5 py-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-white" />
          <h2 className="text-white font-bold text-base">You are signed in</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-gray-600 text-sm break-words">
            <strong>{who}</strong> signed in at {hhmm(signedIn.checkedInAt)}
            {new Date(signedIn.checkedInAt).toDateString() !== new Date().toDateString() && " on " + new Date(signedIn.checkedInAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.
          </p>
          {!readDeviceToken() && (
            <div>
              <label htmlFor="signout-phone" className={labelCls}>Your mobile number</label>
              <input id="signout-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="e.g. 07700 900123" className={inputCls} data-testid="input-signout-phone" />
            </div>
          )}
          {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
          <button
            onClick={() => void doSignOut()}
            disabled={signingOut}
            className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 min-h-11"
            data-testid="button-sign-out"
          >
            {signingOut ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing out…</> : "Sign out of site"}
          </button>
          <button onClick={onCheckedIn} className="w-full border border-gray-200 text-gray-700 font-semibold py-3 rounded-xl min-h-11">
            View site information
          </button>
          <button onClick={notMe} className="w-full text-xs text-gray-500 underline min-h-11" data-testid="button-not-me">
            Not me? Use a different number
          </button>
        </div>
      </div>
    );
  }

  // Held: waiting for the site manager, then the decision.
  if (hold) {
    const why = hold.reason === "unverified"
      ? "your mobile number isn't on file for this project"
      : hold.reason === "insurance_expired" ? "your insurance on file has expired" : "we don't have your insurance on file";
    if (hold.status === "approved") {
      return (
        <div className="bg-white rounded-2xl shadow-sm border p-6 text-center" data-testid="panel-hold-approved">
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
          <h3 className="text-xl font-bold text-gray-900">You're signed in</h3>
          <p className="text-gray-600 text-sm mt-1 mb-4">
            {hold.reason === "unverified"
              ? "The site manager has let you on site. Next time, your mobile number signs you straight in."
              : "The site manager has let you on site. Please get your insurance certificate to them as soon as you can."}
          </p>
          <button onClick={onCheckedIn} className="w-full bg-orange-600 text-white font-semibold py-3 rounded-xl min-h-11">View site information</button>
        </div>
      );
    }
    return (
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" data-testid="panel-hold">
        <div className={`px-5 py-4 flex items-center gap-3 ${hold.status === "pending" ? "bg-gradient-to-r from-amber-600 to-amber-500" : "bg-gradient-to-r from-red-700 to-red-500"}`}>
          <AlertTriangle className="w-5 h-5 text-white shrink-0" />
          <h2 className="text-white font-bold text-base">{hold.status === "pending" ? "Please wait: not cleared yet" : "Site access not permitted"}</h2>
        </div>
        <div className="p-6 text-center space-y-4">
          {hold.status === "pending" ? (
            <>
              <p className="text-gray-900 font-semibold">Do not go on site yet.</p>
              <p className="text-gray-600 text-sm">You can't be signed in because {why}. Your site manager has been told and can let you on. This page updates by itself.</p>
              <div className="flex items-center justify-center gap-2 text-sm text-amber-700"><Loader2 className="w-4 h-4 animate-spin" />Waiting for the site manager</div>
            </>
          ) : (
            <p className="text-gray-600 text-sm">
              {hold.status === "refused"
                ? `The site manager has not let you on site because ${why}.`
                : "Nobody was able to approve you before the end of the day."} Please speak to the site manager.
            </p>
          )}
          {siteManager && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left space-y-2">
              <p className="font-bold text-gray-900 text-center break-words">{siteManager.name}</p>
              {siteManager.phone && (
                <a href={`tel:${siteManager.phone}`} className="flex items-center justify-center gap-2 bg-white border border-amber-300 rounded-lg px-3 py-2 text-amber-800 text-sm font-medium min-h-11 break-all">
                  <Phone className="w-4 h-4 shrink-0" /> {siteManager.phone}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Success screen
  if (status === "done") {
    return (
      <div className="bg-white rounded-2xl shadow-sm border p-6 text-center">
        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-3" />
        <h3 className="text-xl font-bold text-gray-900">Check-In Verified!</h3>
        <p className="text-gray-500 text-sm mt-1 mb-3">
          Your attendance has been recorded at {doneAt ?? new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
        </p>
        <p className="text-green-600 text-sm font-medium">Loading site information…</p>
      </div>
    );
  }

  const photoStep = step === "ready" || useDevice;
  const photoButtons = (
    <>
      {preview && (
        <div className="relative rounded-xl overflow-hidden border">
          <img src={preview} alt="Check-in photo" className="w-full object-contain max-h-72 bg-gray-100" />
          <button
            onClick={() => { setPreview(null); setCapturedFile(null); setStatus("idle"); if (fileRef.current) fileRef.current.value = ""; }}
            className="absolute top-2 right-2 bg-black/50 text-white rounded-full px-2 py-0.5 text-xs"
          >
            Retake
          </button>
        </div>
      )}
      {status !== "capturing" && status !== "uploading" ? (
        <button
          onClick={() => { setErrorMsg(""); fileRef.current?.click(); }}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors min-h-11"
          data-testid="button-take-photo"
        >
          <Camera className="w-5 h-5" /> Take Check-In Photo
        </button>
      ) : (
        <button
          onClick={handleCheckin}
          disabled={status === "uploading"}
          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors min-h-11"
          data-testid="button-confirm-checkin"
        >
          {status === "uploading"
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Verifying &amp; Submitting…</>
            : <><CheckCircle2 className="w-5 h-5" /> Confirm Check-In</>}
        </button>
      )}
    </>
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
      <div className="bg-gradient-to-r from-orange-600 to-orange-500 px-5 py-4 flex items-center gap-3">
        <Camera className="w-5 h-5 text-white" />
        <h2 className="text-white font-bold text-base">Site Check-In Required</h2>
      </div>
      <div className="p-5 space-y-4">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />

        {device && !useDevice && step === "phone" && !signOutMode && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-2" data-testid="card-remembered-device">
            <p className="text-sm text-gray-700 break-words">Welcome back, <strong>{device.workerName}</strong> ({device.companyName}).</p>
            <button
              onClick={() => { setUseDevice(true); setErrorMsg(""); }}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl min-h-11"
              data-testid="button-sign-in-as"
            >
              Sign in as {device.workerName}, {device.companyName}
            </button>
            <button onClick={notMe} className="w-full text-xs text-gray-500 underline min-h-11" data-testid="button-not-me-device">Not me? Use a different number</button>
          </div>
        )}

        {signOutMode ? (
          <div className="rounded-xl border border-gray-200 p-4 space-y-3" data-testid="panel-sign-out-by-phone">
            <p className="text-sm text-gray-700">Leaving site? Enter the mobile number you signed in with.</p>
            <div>
              <label htmlFor="signout-phone-form" className={labelCls}>Your mobile number</label>
              <input id="signout-phone-form" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="e.g. 07700 900123" className={inputCls} data-testid="input-signout-phone-form" />
            </div>
            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
            <button
              onClick={() => void doSignOut()}
              disabled={signingOut}
              className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 min-h-11"
              data-testid="button-sign-out-by-phone"
            >
              {signingOut ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing out…</> : "Sign out of site"}
            </button>
            <button onClick={() => { setSignOutMode(false); setErrorMsg(""); }} className="w-full text-xs text-gray-500 underline min-h-11">Back to check-in</button>
          </div>
        ) : useDevice && device ? (
          <>
            <p className="text-sm text-gray-700 break-words">Signing in as <strong>{device.workerName}</strong> ({device.companyName}). Take your photo to finish.</p>
            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
            {photoButtons}
            <button onClick={() => { setUseDevice(false); setStatus("idle"); setPreview(null); setCapturedFile(null); }} className="w-full text-xs text-gray-500 underline min-h-11">Back</button>
          </>
        ) : step === "phone" ? (
          <>
            <p className="text-gray-600 text-sm">Sign in with your mobile number. If we have it on file for this project, you're signed straight in.</p>
            <div>
              <label htmlFor="checkin-phone" className={labelCls}><span className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Your mobile number</span></label>
              <input id="checkin-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone}
                onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void lookUp(); }}
                placeholder="e.g. 07700 900123" className={inputCls} data-testid="input-checkin-phone" />
            </div>
            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
            <button onClick={() => void lookUp()} disabled={looking}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 min-h-11"
              data-testid="button-checkin-continue">
              {looking ? <><Loader2 className="w-5 h-5 animate-spin" /> Checking…</> : "Continue"}
            </button>
            <button onClick={() => { setSignOutMode(true); setErrorMsg(""); }} className="w-full text-sm text-gray-600 underline min-h-11" data-testid="button-signing-out">
              Already on site and leaving? Sign out
            </button>
          </>
        ) : step === "confirm" ? (
          <div className="space-y-3" data-testid="panel-is-this-you">
            <p className="text-sm font-semibold text-gray-900">Is this you?</p>
            {matches.map(m => (
              <button key={m.matchToken} onClick={() => { setConfirmed(m); setStep("ready"); setErrorMsg(""); }}
                className="w-full flex items-center justify-between gap-3 bg-white border-2 border-orange-200 rounded-xl px-4 py-3 min-h-11 text-left"
                data-testid="button-this-is-me">
                <span className="text-base font-semibold text-gray-900 break-words min-w-0">{m.label}</span>
                <span className="text-xs text-orange-600 font-bold shrink-0">Yes, that's me</span>
              </button>
            ))}
            <button onClick={() => { setStep("details"); setErrorMsg(""); }} className="w-full text-sm text-gray-600 underline min-h-11" data-testid="button-not-these">
              No, that's not me
            </button>
            <button onClick={reset} className="w-full text-xs text-gray-500 underline min-h-11">Use a different number</button>
          </div>
        ) : step === "details" ? (
          <div className="space-y-4" data-testid="panel-number-not-on-file">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 break-words">
              {checkingPaused
                ? <>We can't check mobile numbers just now. Enter your name and company and the site manager will let you on.</>
                : <>We don't have <strong>{phone.trim()}</strong> on file for this project. Enter your name and company and the site manager will let you on. Once they do, this number signs you straight in next time.</>}
            </div>
            <div>
              <label htmlFor="checkin-name" className={labelCls}>Your name</label>
              <input id="checkin-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. John Smith" className={inputCls} data-testid="input-checkin-name" />
            </div>
            <div>
              <label htmlFor="checkin-company" className={labelCls}><span className="inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Company name</span></label>
              <input id="checkin-company" type="text" autoComplete="organization" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Electrical Ltd" className={inputCls} data-testid="input-checkin-company" />
            </div>
            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
            <button
              onClick={() => {
                if (!name.trim()) { setErrorMsg("Please enter your name."); return; }
                if (!companyName.trim()) { setErrorMsg("Please enter your company name."); return; }
                setErrorMsg(""); setStep("ready");
              }}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl min-h-11"
              data-testid="button-details-continue"
            >
              Continue
            </button>
            <button onClick={reset} className="w-full text-xs text-gray-500 underline min-h-11">Use a different number</button>
          </div>
        ) : photoStep ? (
          <>
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 flex flex-wrap items-center justify-between gap-2" data-testid="chip-confirmed-match">
              <p className="text-sm text-green-900 break-words min-w-0">
                {confirmed ? <>Checking in as <strong>{confirmed.label}</strong></> : <>Checking in as <strong>{name.trim()}</strong>, {companyName.trim()}. The site manager will need to let you on.</>}
              </p>
              <button onClick={reset} className="text-xs text-gray-600 underline shrink-0 min-h-11" data-testid="button-clear-confirmed">Change</button>
            </div>
            {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
            {photoButtons}
          </>
        ) : null}

        <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-1">
          <p className="font-semibold text-gray-600">Check-in requirements:</p>
          <p>✓ Your mobile number, or the site manager lets you on</p>
          <p>✓ Subcontractors must have a valid insurance certificate on record</p>
          <p>✓ Site photo required</p>
        </div>
      </div>
    </div>
  );
}

export default function SiteBoard() {
  const [, params] = useRoute("/site/:token");
  const token = params?.token ?? "";

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  // Live count only (never names) of people signed in and not signed out.
  // HIDDEN (2026-10-07): it said 5 "on site" on an empty test site because
  // nobody was ever signed out automatically. #114 fixed the count itself
  // (automatic close at the site close time; held check-ins never count), so
  // showing it again is now a product decision (backlog F7), not a bug fix.
  const [onSiteCount, setOnSiteCount] = useState<number | null>(null);
  useEffect(() => {
    if (!token || !SHOW_PUBLIC_ON_SITE_COUNT) return;
    const load = () => fetch(`/api/site/${token}/on-site-count`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.count === "number") setOnSiteCount(d.count); })
      .catch(() => {});
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [token, checkedIn]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/site/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.message ?? "Failed to load site board");
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading site board…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Site Board Not Found</h2>
          <p className="text-gray-500">This QR code may be invalid or the project has been archived.</p>
        </div>
      </div>
    );
  }

  const { project, siteManager, teamSize, permits, documents, pinnedItems = [], generatedAt } = data;

  // Gate: show check-in form until the worker has successfully checked in
  if (!checkedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white">
        <div className="bg-gradient-to-r from-orange-700 to-orange-500 text-white px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <p className="text-orange-200 text-sm font-medium uppercase tracking-wider mb-1">SiteSort · Site Board</p>
            <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">{project.name}</h1>
            <div className="flex items-center gap-2 mt-2 text-orange-100">
              <MapPin className="w-4 h-4 shrink-0" />
              <span className="text-sm">{project.address}</span>
            </div>
            {onSiteCount !== null && (
              <div className="flex items-center gap-2 mt-2 text-orange-100" data-testid="text-on-site-now">
                <Users className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold">{onSiteCount} currently on site</span>
              </div>
            )}
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-6">
          <CheckInCard
            token={token}
            projectName={project.name}
            siteManager={siteManager}
            onCheckedIn={() => setCheckedIn(true)}
          />
        </div>
      </div>
    );
  }

  const activePermits = permits.filter((p: any) => {
    const expiry = new Date(p.expiryDate);
    return !isNaN(expiry.getTime()) && expiry >= new Date();
  });

  const expiringPermits = permits.filter((p: any) => {
    const expiry = new Date(p.expiryDate);
    if (isNaN(expiry.getTime())) return false;
    const now = new Date();
    const daysUntil = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil >= 0 && daysUntil <= 30;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white print:bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-700 to-orange-500 text-white px-4 py-8 print:py-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-orange-200 text-sm font-medium uppercase tracking-wider mb-1">SiteSort · Site Board</p>
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">{project.name}</h1>
              <div className="flex items-center gap-2 mt-2 text-orange-100">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="text-sm">{project.address}</span>
              </div>
            </div>
            <StatusBadge status={project.status} />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Verified badge */}
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          <p className="text-green-800 text-sm font-medium">Check-in verified. You are cleared to access the site.</p>
        </div>

        {/* Key info strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Calendar className="w-3.5 h-3.5" /> Start Date
            </div>
            <p className="font-bold text-gray-900 text-sm">
              {new Date(project.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          {project.targetEndDate && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Clock className="w-3.5 h-3.5" /> Target End
              </div>
              <p className="font-bold text-gray-900 text-sm">
                {new Date(project.targetEndDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          )}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
              <Users className="w-3.5 h-3.5" /> Team Size
            </div>
            <p className="font-bold text-gray-900 text-sm">{teamSize} {teamSize === 1 ? "member" : "members"}</p>
          </div>
          {onSiteCount !== null && (
            <div className="bg-white rounded-xl shadow-sm border p-4" data-testid="card-on-site-now">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Users className="w-3.5 h-3.5" /> On Site Now
              </div>
              <p className="font-bold text-gray-900 text-sm">{onSiteCount} currently on site</p>
            </div>
          )}
        </div>

        {/* Expiring permits alert */}
        {expiringPermits.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 text-sm">Permits expiring soon</p>
              <p className="text-amber-700 text-xs mt-0.5">
                {expiringPermits.map((p: any) => p.type).join(", ")} · check with your site manager
              </p>
            </div>
          </div>
        )}

        {/* Site manager */}
        {siteManager && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <HardHat className="w-4 h-4" /> Site Manager
            </h2>
            <p className="font-bold text-gray-900 text-lg">{siteManager.name}</p>
            <a
              href={`mailto:${siteManager.email}`}
              className="inline-flex items-center gap-2 text-orange-600 font-medium text-sm mt-1.5 hover:underline"
            >
              <Mail className="w-4 h-4" /> {siteManager.email}
            </a>
            {siteManager.phone && (
              <a
                href={`tel:${siteManager.phone}`}
                className="flex items-center gap-2 text-orange-600 font-medium text-sm mt-1 hover:underline"
              >
                <Phone className="w-4 h-4" /> {siteManager.phone}
              </a>
            )}
          </div>
        )}

        {/* Active permits */}
        {activePermits.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Active Permits
            </h2>
            <div className="space-y-3">
              {activePermits.map((p: any) => (
                <div key={p.id} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{p.type}</p>
                    <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{p.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">Expires</p>
                    <p className="text-sm font-bold text-gray-700">
                      {new Date(p.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public documents */}
        {documents.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Documents on Display
            </h2>
            <div className="space-y-2">
              {documents.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{d.name}</p>
                    <p className="text-gray-400 text-xs">{TYPE_LABELS[d.type] ?? d.type} · v{d.version}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trades */}
        {project.trades?.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <HardHat className="w-4 h-4" /> Trades on Site
            </h2>
            <div className="flex flex-wrap gap-2">
              {project.trades.map((t: string) => (
                <span key={t} className="px-3 py-1 bg-orange-50 text-orange-800 rounded-full text-sm font-medium border border-orange-200">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Pinned to this board */}
        {pinnedItems.length > 0 && (() => {
          const pinnedDocs = pinnedItems.filter((p: any) => p.itemType === "document");
          const pinnedPhotos = pinnedItems.filter((p: any) => p.itemType === "photo");
          const pinnedPermits = pinnedItems.filter((p: any) => p.itemType === "permit");
          const statusColors: Record<string, string> = { active: "bg-green-100 text-green-800", expiring_soon: "bg-amber-100 text-amber-800", expired: "bg-red-100 text-red-800" };
          const statusLabels: Record<string, string> = { active: "Active", expiring_soon: "Expiring Soon", expired: "Expired" };
          return (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Pin className="w-4 h-4" /> Pinned to this Board
              </h2>

              {pinnedDocs.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Documents</p>
                  <div className="space-y-0 divide-y">
                    {pinnedDocs.map((doc: any) => (
                      <div key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 text-sm truncate flex items-center gap-1.5">
                              <span className="truncate">{doc.name}</span>
                              {doc.superseded && (
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Superseded</span>
                              )}
                            </p>
                            <p className="text-gray-400 text-xs">{TYPE_LABELS[doc.type] ?? doc.type} · v{doc.version}</p>
                          </div>
                        </div>
                        {doc.fileUrl && (
                          // CAD files (DWG/DXF/…) can't render in a browser tab — a raw
                          // window.open() left a blank tab; download them instead, same
                          // as every other document view in the app.
                          <button onClick={() => openDocument(doc.fileUrl, doc.name)} className="shrink-0 text-orange-600 text-xs font-semibold hover:underline">View</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pinnedPhotos.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Photos</p>
                  <div className="grid grid-cols-2 gap-2">
                    {pinnedPhotos.map((photo: any) => (
                      <div key={photo.id} className="rounded-lg overflow-hidden border bg-gray-50">
                        {photo.photoUrl && (
                          <img
                            src={photo.photoUrl}
                            alt={photo.referenceNumber}
                            className="w-full h-24 object-cover cursor-pointer"
                            onClick={() => window.open(photo.photoUrl)}
                          />
                        )}
                        <div className="px-2 py-1.5">
                          <p className="text-xs font-medium text-gray-700 truncate">{photo.referenceNumber}</p>
                          <p className="text-xs text-gray-400 truncate capitalize">{photo.category}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pinnedPermits.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Permits</p>
                  <div className="space-y-0 divide-y">
                    {pinnedPermits.map((permit: any) => (
                      <div key={permit.id} className="flex items-start justify-between gap-2 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{permit.type}</p>
                          {permit.description && <p className="text-gray-500 text-xs mt-0.5 truncate">{permit.description}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[permit.status] ?? "bg-gray-100 text-gray-700"}`}>
                            {statusLabels[permit.status] ?? permit.status}
                          </span>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(permit.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-4 pt-2">
          <p>Powered by <span className="font-semibold text-orange-500">SiteSort</span></p>
          <p className="mt-0.5">Last updated {generatedAt ? new Date(generatedAt).toLocaleString("en-GB") : "N/A"}</p>
        </div>
      </div>
    </div>
  );
}
