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
      {
        heading: "Find your way around a project",
        body: [
          "The project tabs are Overview, Progress, Documents, H&S, Plant & Materials, Daily Reports, Team, Team Portal, Site Board, Check-Ins, Site Issues and Close-Out. The tabs you see depend on your role and permissions.",
          "On a wide desktop screen the tabs sit in two rows. On tablet and phone they wrap into more rows to keep the labels readable.",
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
      {
        heading: "Use a contact's action pills",
        body: [
          "Contacts have labelled buttons such as Call, Text, WhatsApp, Email, Notes, Docs and Share. Available contact methods depend on the details saved for that person. Managers also see Insurance, Add to project, Edit and Remove. These buttons wrap onto extra rows on smaller screens.",
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
          "From a project's Site Board tab, pin documents, permits or photos so they show on the public board anyone can see by scanning the code. No login needed.",
        ],
      },
      {
        heading: "See who is on site right now",
        body: [
          "The project's Check-Ins tab (and the Check-Ins page) opens with Currently on site: everyone who has signed in and not yet signed out, so you can use it for a roll call.",
          "The public site board (the page the QR code opens) shows a live count, for example 12 currently on site. It is a number only; names are only visible to you here.",
          "In your notifications and the dashboard activity feed, tap a Check-in, Signed out or Check-in blocked item to open its detail: the photo (tap to enlarge), name, company, in and out times, a link to Currently on site, and for a blocked attempt exactly what they typed and why it was blocked. Sign-outs appear in the feed as well, so a sign-out between two check-ins is easy to see.",
          "Anyone still signed in from a previous day is flagged Not signed out. They are never closed automatically. Choose Sign out beside their name, add a note (for example, left site at 17:00) and confirm. Admins and project managers can do this.",
        ],
      },
    ],
  },
  {
    id: "activity",
    title: "Activity and notification history",
    steps: [
      {
        heading: "Keep the dashboard brief; open the full history when needed",
        body: [
          "Recent Activity on the dashboard shows your latest eight updates. Choose View all to open Notifications: this month's activity stays visible, while earlier updates sit in collapsible month folders, newest month first.",
          "Open a month folder to see its entries. Notification filters apply across the full history, including older months. Grouping into folders does not delete activity.",
        ],
      },
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
          "The project's Site Issues tab lists issues logged by your team. Close a resolved one, or use Close as invalid/duplicate with a reason if it wasn't a real issue.",
        ],
      },
      {
        heading: "Dictate instead of typing",
        body: [
          "On the dashboard, the Plant & Materials Add/Edit form has microphone buttons beside the item name, location and notes. Log Issue has them beside the description and zone/location.",
          "Select the microphone, allow microphone access if prompted, speak, then stop recording. Wait for the text to appear. Dictation appends to existing text rather than replacing it; review and edit it before saving.",
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
    title: "Team insurance and site-access compliance",
    steps: [
      {
        heading: "Review Team Compliance & Site Access",
        body: [
          "In the project's H&S tab, Team Compliance & Site Access shows insurance-based compliance, public liability certificate expiry dates and flagged site-access restrictions. Use Check-Ins for attendance records; this H&S section is not a training-qualifications or live check-in list.",
        ],
      },
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
    id: "plant-and-report-photos",
    title: "Plant on hire and report photos",
    steps: [
      {
        heading: "Plant on hire stays on your dashboard",
        body: [
          "Hired plant appears under Plant on hire on the dashboard until you mark it Off-hired on the project's Plant & Materials tab. Plant past its expected off-hire date shows in red as Overdue, with the date it was due off hire, and sits at the top.",
        ],
      },
      {
        heading: "Add photos to a daily report",
        body: [
          "Open a daily site report and choose Add Photos. Drop several photos at once or browse, add an optional caption to each, then save. They show in the report and also appear in the project's photo library tagged with the report date, so there is no need to upload them twice.",
        ],
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
      {
        heading: "Choose a project without signing out",
        body: [
          "If you belong to more than one project, open Your projects on the portal Home screen. The current project and every other entry show both the project name and company name. Only projects you have access to appear.",
          "Choose another project in the same company to switch straight away. If it belongs to a different company, a confirmation names the company and project: choose Continue to switch or Cancel to stay where you are. No extra PIN or password is required for this confirmation.",
          "After a successful switch the page refreshes to show the selected project. Opening the app again keeps you in your last-active project while you still have access.",
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
      {
        heading: "Sign out when you leave",
        body: [
          "Scan the same QR code again. On the phone you signed in with, you will see Sign out of site straight away; choose it and your time is recorded. When you are signed out, the same phone offers Sign in as your name and company, so you only need to take the photo. Choose Not me if it is someone else's phone.",
          "On a different phone, start typing your name. After three letters, people currently signed in on this site appear (first name and company only) so you can tap yourself and sign out. If your spelling is slightly off, you will be asked Did you mean...? to confirm; nothing is ever signed out without your tap. The same happens when signing in: if your name or company is a close match to someone registered on the project (for example 'I cloud' for 'Amy I Cloud'), you are asked to confirm rather than being turned away. The company box suggests companies already on this project, and you can still type a new one.",
          "You can sign in and out as many times as you need in a day, for example for lunch. Each visit is recorded separately. If you forget to sign out, tell your site manager so they can do it for you.",
        ],
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
      {
        heading: "Use voice input where a microphone is shown",
        body: [
          "You can dictate into supported fields in Site Issues, Plant & Materials and Daily Report. Tap the microphone, allow access if asked, speak and tap again to stop. Wait for transcription to finish, then check and edit the text.",
          "Dictation adds to what is already in the field. It does not save or submit the entry for you.",
        ],
      },
      {
        heading: "Add photos to today's daily report",
        body: [
          "If you can edit the daily report, choose Add Photos under today's report. Drop several photos at once or browse, add an optional caption to each, then save. They join the report and the project's photo library, tagged with the report date.",
          "Photos can be added until you submit the report or the day is locked, the same as the written notes. Past reports show their photos read-only.",
        ],
      },
    ],
  },
];

export const FAQ: FaqItem[] = [
  {
    id: "switch-projects",
    question: "Can I use the portal for projects at different companies?",
    answer: "Yes, if each project has granted you access. Open Your projects on the portal Home screen and check both the company and project name. Same-company choices switch immediately; a different company asks you to Continue or Cancel first. The app keeps your last-active project when you reopen it while you still have access.",
    audience: "both",
  },
  {
    id: "older-activity",
    question: "Where did older dashboard activity go?",
    answer: "The dashboard shows the latest eight updates. Choose View all to open Notifications. This month's entries are visible there, and older entries are grouped into expandable month folders. They have not been deleted.",
    audience: "pm",
  },
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
