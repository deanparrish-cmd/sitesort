import { logger } from "./logger";

// Team Portal invite delivery — DEFERRED PROVIDER.
//
// The spec is explicit: for now "sending" an invite = showing the PM a copyable
// link. This function is the single slot where a real email provider drops in
// later WITHOUT touching the invite route. The rest of lib/email.ts already uses
// Resend; to actually send, mirror sendVerificationEmail there and call it here.
//
// It never throws — invite creation must succeed and return the link even if
// (future) delivery fails; the PM always has the copyable link as the fallback.
export async function sendProjectInviteEmail(params: {
  email: string;
  name: string;
  projectName: string;
  inviteUrl: string;
}): Promise<{ delivered: boolean }> {
  try {
    // TODO(email): wire to Resend (see lib/email.ts). Until then, no-op + log.
    logger.info(
      { email: params.email, project: params.projectName },
      "Project invite created (email delivery deferred — PM shares the copyable link)",
    );
    return { delivered: false };
  } catch (err) {
    logger.error({ err }, "sendProjectInviteEmail failed (non-fatal)");
    return { delivered: false };
  }
}
