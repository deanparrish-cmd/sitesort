import { logger } from "./logger";
import { sendPortalInviteEmail } from "./email";

// Team Portal invite delivery. This is the single business-logic-facing slot: the
// invite route calls this, and the actual provider (Resend) lives in lib/email.ts
// so it can be swapped without touching the route. NEVER throws — invite creation
// must still succeed (and return the copyable link) even if delivery fails; the PM
// always has the Copy link / Resend fallback.
export async function sendProjectInviteEmail(params: {
  email: string;
  name: string;
  inviterName: string;
  companyName: string;
  projectName: string;
  role: string;
  inviteUrl: string;
}): Promise<{ delivered: boolean; providerId?: string; error?: string }> {
  try {
    const res = await sendPortalInviteEmail({
      to: params.email,
      name: params.name,
      inviterName: params.inviterName,
      companyName: params.companyName,
      projectName: params.projectName,
      role: params.role,
      inviteUrl: params.inviteUrl,
    });
    // Resend returns { data: { id }, error }. A non-null error means it was rejected.
    if (res.error) {
      logger.error({ email: params.email, project: params.projectName, err: res.error }, "Portal invite email rejected by provider");
      return { delivered: false, error: res.error.message ?? "send_rejected" };
    }
    logger.info({ email: params.email, project: params.projectName, providerId: res.data?.id }, "Portal invite email sent");
    return { delivered: true, providerId: res.data?.id };
  } catch (err: any) {
    logger.error({ err, email: params.email, project: params.projectName }, "sendProjectInviteEmail failed (non-fatal)");
    return { delivered: false, error: err?.message ?? "send_error" };
  }
}
