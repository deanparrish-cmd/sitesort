// Single shared source for the in-app User Guide. Consumed by:
//   - the dashboard "User Guide" page (full guide)
//   - the portal "Help" page (WORKER_GUIDE + workerFaq() only)
//   - the "Invite to Portal" email (a short excerpt of WORKER_GUIDE)
// Edit copy here — layout for all three lives elsewhere and reads this file,
// so a copy change updates everywhere at once.

export type GuideCallout = {
  tone: "tip" | "note";
  text: string;
};

export type GuideStep = {
  heading: string;
  body: string[];
  // An optional colored aside rendered under this step — "tip" for a handy
  // shortcut, "note" for something worth flagging. Keep rare: only the most
  // useful asides, not every step.
  callout?: GuideCallout;
};

export type GuideSection = {
  id: string;
  title: string;
  steps: GuideStep[];
};

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  // "both" items show in the portal FAQ as well as the dashboard's.
  audience: "pm" | "worker" | "both";
};

export const PM_GUIDE_TITLE = "For project managers";
export const WORKER_GUIDE_TITLE = "For site workers";

export const PM_GUIDE: GuideSection[] = [
  {
    id: "projects",
    title: "Creating and managing projects",
    steps: [
      {
        heading: "Start a new project",
        body: [
          "Go to Projects in the sidebar and click New Project. Add the project name, address and dates. You can edit these any time from the project's Overview tab.",
        ],
      },
    ],
  },
  {
    id: "contacts-team",
    title: "Adding contacts and your team",
    steps: [
      {
        heading: "Build your company directory first",
        body: [
          "Subcontractors, self-employed contacts and merchants live in Contacts (company-wide). Add someone there once, with their trade and contact details.",
        ],
      },
      {
        heading: "Then add them to a project",
        body: [
          "Open a project's Team tab and use Add to Project to bring in anyone already in your Contacts directory. Your own staff (admins, project managers, site workers) are managed separately under In House Team.",
        ],
      },
    ],
  },
  {
    id: "documents",
    title: "Uploading and version-controlling documents",
    steps: [
      {
        heading: "Upload to a project",
        body: [
          "From a project's Documents tab, upload a file and choose its type. If it replaces an earlier version of the same document, pick it in the \"supersedes\" list, and the old one is automatically marked SUPERSEDED and stays visible for reference.",
        ],
      },
      {
        heading: "New versions and re-acknowledgement",
        body: [
          "When you share a new version, the people you share it with are notified and asked to acknowledge it, even if they had already acknowledged the old one. Anyone opening a superseded document sees a prompt offering the latest version instead.",
        ],
      },
      {
        heading: "Require a PIN on any document",
        body: [
          "Safety-critical types (method statements, permits and safety documents) always need a PIN to sign off. For any other document, tick \"Require a PIN to sign off\" when uploading, or switch it on later from the document's edit screen.",
        ],
      },
    ],
  },
  {
    id: "sharing",
    title: "Sharing to the Team Portal",
    steps: [
      {
        heading: "Share a document, photo or permit",
        body: [
          "Click Share on any document, photo or permit. Choose Everyone, one or more trades, or specific people. This both notifies the recipients and makes the item visible to them in their portal: one action does both.",
        ],
        callout: {
          tone: "tip",
          text: "Trade shares also reach anyone invited to that trade later, so you don't need to re-share when a new person joins.",
        },
      },
    ],
  },
  {
    id: "invites",
    title: "Inviting workers to the portal",
    steps: [
      {
        heading: "Send an invite",
        body: [
          "On a project's Team tab, click Invite to Portal on a person's card. They'll get an email with a link to set up access; you can also Copy link to share it directly (by text, WhatsApp, etc.).",
          "If their email already has a SiteSort login, they can join with their existing password instead of setting a new one. Invite links keep working even after they've been accepted, so re-sending an old link won't lock anyone out.",
        ],
      },
      {
        heading: "Manage access",
        body: [
          "The Portal member pill on their card is the on/off switch for their whole portal login.",
        ],
        callout: {
          tone: "note",
          text: "Turning it off ends any active session immediately and cancels a pending invite.",
        },
      },
    ],
  },
  {
    id: "permissions",
    title: "Granting portal permissions",
    steps: [
      {
        heading: "Site Issues, Plant & Materials, Daily Report",
        body: [
          "By default a new portal member sees only Overview, Messages, Shared with me, My documents, Permits and Site Board. To let someone log site issues, update plant & materials, or edit the daily report, turn on the matching pill (Site Issues / Plant & Materials / Daily Report) on their Team tab card. Each is independent and can be switched off again at any time.",
        ],
      },
    ],
  },
  {
    id: "qr-board",
    title: "The QR site board",
    steps: [
      {
        heading: "Generate and print",
        body: [
          "QR Codes in the sidebar lists a QR code per project. Download or print it for site signage.",
        ],
      },
      {
        heading: "Pin what's on display",
        body: [
          "From a project's own QR tab, pin documents, permits or photos so they show on the public board anyone can see by scanning the code. No login needed.",
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "The activity log",
    steps: [
      {
        heading: "See what's happened",
        body: [
          "A project's Overview tab shows its recent activity feed. For a closer look at what individual portal members have opened, viewed or actioned, use the project's Team Activity view.",
        ],
      },
    ],
  },
  {
    id: "issues-signoffs",
    title: "Triaging site issues and sign-offs",
    steps: [
      {
        heading: "Site issues",
        body: [
          "The project's Issues tab lists everything logged by your team, in-app or shared. Close a resolved one, or use Close as invalid/duplicate with a reason if it wasn't a real issue.",
        ],
      },
      {
        heading: "Sign-offs",
        body: [
          "Pending Sign-offs (on the dashboard and in Compliance) shows documents waiting for someone's confirmation. For safety-critical documents (method statements, permits and safety documents), or any document where you've switched on \"Require a PIN to sign off\", the signer enters their 4-digit PIN. Everything else uses a simple read-and-confirm step, no PIN needed.",
        ],
      },
    ],
  },
  {
    id: "team-certs",
    title: "Insurance certificates on the Team tab",
    steps: [
      {
        heading: "See and update a member's certificate",
        body: [
          "Each member's card on the Team tab shows their PLI certificate with its expiry date and a button to open the document. To add or replace one, expand the certificate area on their card, upload the PDF or photo, set the expiry date and save.",
        ],
        callout: {
          tone: "note",
          text: "Certificates a worker submits through the portal are filed against their record automatically once you file them from Team Activity, and filed submissions leave the review queue on their own.",
        },
      },
    ],
  },
  {
    id: "approver-cover",
    title: "Cover for absence",
    steps: [
      {
        heading: "Set your project's approvers in one place",
        body: [
          "Open the project and choose Edit Project Details. The \"Project Managers / Approvers\" field lists everyone with approver authority on that project, so you can add or remove approvers in one place.",
        ],
      },
      {
        heading: "Delegate approver authority for one project",
        body: [
          "If you're away, grant the Project Manager pill to someone else on that project's Team tab. It gives them the same authority as a PM on that project only (triaging issues, sharing to the portal, managing permissions) without changing their company-wide role.",
        ],
        callout: {
          tone: "note",
          text: "Revoke it the same way when you're back. Access ends immediately.",
        },
      },
    ],
  },
];

export const WORKER_GUIDE: GuideSection[] = [
  {
    id: "accept-invite",
    title: "Accepting your invite",
    steps: [
      {
        heading: "Set up your access",
        body: [
          "Open the link in your invite email (or the link your project manager sent you) and set a password. If you already have a SiteSort login, you can join with that instead. Just confirm it's you.",
        ],
      },
      {
        heading: "Sign in",
        body: [
          "After that, sign in any time at the portal login page with your email and password.",
        ],
      },
    ],
  },
  {
    id: "getting-around",
    title: "Getting around the portal",
    steps: [
      {
        heading: "Everything starts from Home",
        body: [
          "Your Home screen shows a big tile for each section: Messages, Shared with me, My documents, Site Board, Permits and Settings (plus Site Tasks if your project manager has given you those permissions). Tap a tile to open a section.",
        ],
      },
      {
        heading: "Getting back",
        body: [
          "From any section, tap the Home button in the top corner (or the SiteSort logo) to go back to your Home screen.",
        ],
      },
    ],
  },
  {
    id: "home-screen",
    title: "Adding SiteSort to your home screen",
    steps: [
      {
        heading: "Android",
        body: [
          "You'll usually see an Install prompt: tap it to add SiteSort as an app icon.",
        ],
      },
      {
        heading: "iPhone (Safari)",
        body: [
          "Tap the Share icon in Safari, choose Add to Home Screen, then open SiteSort from your Home Screen and come back here.",
        ],
        callout: {
          tone: "note",
          text: "On iPhone and iPad, notifications only work once SiteSort is installed on your Home Screen and opened from there.",
        },
      },
    ],
  },
  {
    id: "site-checkin",
    title: "Checking in on site",
    steps: [
      {
        heading: "Scan the site board",
        body: [
          "Scan the QR code posted on site (or open it from Site Board in the portal). Complete your check-in (your details are matched against the project's contacts), then take a photo when prompted. It's automatically stamped with your name, the date and the project.",
        ],
        callout: {
          tone: "tip",
          text: "No portal login is needed for this step.",
        },
      },
    ],
  },
  {
    id: "shared-with-me",
    title: "Finding what's shared with you",
    steps: [
      {
        heading: "Shared with me",
        body: [
          "Everything your project manager has shared with you (drawings, method statements, safety documents, permits and more) is in Shared with me. Use the category filter to narrow it down.",
        ],
      },
    ],
  },
  {
    id: "drawings",
    title: "Current vs superseded drawings",
    steps: [
      {
        heading: "Know you're looking at the latest version",
        body: [
          "A document marked Superseded has been replaced. If you open one anyway, you'll see a prompt offering to open the latest version instead.",
          "If a new version of a document is shared with you, you'll be notified and asked to acknowledge it, even if you'd acknowledged the earlier version.",
        ],
      },
    ],
  },
  {
    id: "messages-notifications",
    title: "Messages and notifications",
    steps: [
      {
        heading: "Messages",
        body: [
          "Chat with your project manager or teammates, or post in the project's shared channel.",
        ],
      },
      {
        heading: "Notifications",
        body: [
          "New shares, messages and updates show up here. Tap one to jump straight to it.",
          "To get alerts on your phone even when SiteSort is closed, tap Enable notifications when the portal offers it (or switch them on in Settings). On iPhone and iPad, install SiteSort on your Home Screen first.",
        ],
      },
    ],
  },
  {
    id: "logging-work",
    title: "Logging site issues, plant & materials, and daily reports",
    steps: [
      {
        heading: "Only if your project manager has granted it",
        body: [
          "If you've been given access, you'll see Site Issues, Plant & Materials and/or Daily Report in your menu. If you don't see one of these, your project manager hasn't switched it on for you.",
        ],
      },
      {
        heading: "Save vs Submit",
        body: [
          "Saving keeps an entry as a draft that only you can see and edit. Submit to PM locks it and sends it to your project manager.",
        ],
        callout: {
          tone: "note",
          text: "After you submit, add updates as notes rather than editing the original, so there's always a clear record of what was said and when.",
        },
      },
    ],
  },
];

export const FAQ: FaqItem[] = [
  {
    id: "invite-spam",
    question: "I can't find my invite email",
    answer: "Check your spam or junk folder first. If it's still not there, ask your project manager to resend it or send you the Copy link directly.",
    audience: "both",
  },
  {
    id: "check-in-how",
    question: "How do I check in on site?",
    answer: "Scan the QR code on the site board (or open Site Board in the portal), complete your check-in details, then take the photo when prompted. It's stamped automatically. No portal login is needed for this step.",
    audience: "worker",
  },
  {
    id: "default-worker-view",
    question: "What does a brand-new worker see by default?",
    answer: "Just Overview, Messages, Shared with me, My documents, Permits, Site Board and Settings. Site Issues, Plant & Materials and Daily Report are hidden until a project manager grants that specific permission.",
    audience: "both",
  },
  {
    id: "signoff-pin",
    question: "How do sign-off PINs work?",
    answer: "A PIN is only asked for on safety-critical documents (method statements, permits and safety documents) or where your project manager has switched it on for a specific document; everything else is a simple read-and-confirm. The first time you sign off with a PIN, you'll set a 4-digit PIN (confirmed with your account password). After that, entering the same PIN confirms each sign-off. Forgotten it? Use \"Forgot your PIN? Reset it with your password\" on the sign-off screen.",
    audience: "both",
  },
  {
    id: "remove-access",
    question: "How do I remove someone's portal access?",
    answer: "On the project's Team tab, turn off the Portal member pill on their card. This ends their session immediately and cancels any pending invite.",
    audience: "pm",
  },
  {
    id: "iphone-notifications",
    question: "Why am I not getting notifications on my iPhone or iPad?",
    answer: "Apple only allows web notifications for apps installed on the Home Screen. In Safari, tap Share, choose Add to Home Screen, then open SiteSort from that icon and enable notifications when asked (or from Settings).",
    audience: "worker",
  },
  {
    id: "shared-logins",
    question: "Can two people share one login?",
    answer: "No, each person needs their own invite and login. Sign-offs, activity and check-ins are all recorded against the individual, so a shared login would make that record wrong.",
    audience: "both",
  },
];

export function workerFaq(): FaqItem[] {
  return FAQ.filter(f => f.audience !== "pm");
}
