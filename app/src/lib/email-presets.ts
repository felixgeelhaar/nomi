// Per-provider IMAP/SMTP presets for the Email plugin. Used by the
// Plugins-tab "Add connection" dialog to auto-fill the host/port fields
// when the user picks a known provider.
//
// Settings verified against each provider's public documentation as of
// 2025; update if a provider changes its endpoints. When adding a new
// preset, keep the docURL so the UI can link to the provider's
// app-password setup page (users always need that first step for
// modern providers that don't accept raw account passwords).

export interface EmailProviderPreset {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  // authNote surfaces the one thing a user needs to know before entering
  // a password: whether it should be an app password, OAuth token, etc.
  authNote: string;
  // docURL links to the provider's credential-setup instructions.
  docURL: string;
  // domainMatchers are email-address domains that suggest this preset.
  // Used to auto-detect the right preset once the user types their email.
  domainMatchers: string[];
}

export const EMAIL_PROVIDER_PRESETS: EmailProviderPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    authNote:
      "Gmail requires an app password, not your regular account password. 2-Step Verification must be enabled.",
    docURL: "https://support.google.com/accounts/answer/185833",
    domainMatchers: ["gmail.com", "googlemail.com"],
  },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    authNote:
      "Microsoft accounts with MFA require an app password, created from account security settings.",
    docURL: "https://support.microsoft.com/office/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9",
    domainMatchers: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
  },
  {
    id: "fastmail",
    label: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    smtpHost: "smtp.fastmail.com",
    smtpPort: 587,
    authNote:
      "Create a dedicated app password from Settings → Password & Security → App Passwords.",
    docURL: "https://www.fastmail.help/hc/en-us/articles/360058752854",
    domainMatchers: ["fastmail.com", "fastmail.fm", "fastmail.net"],
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
    authNote:
      "Yahoo requires an app password from Account Security. Primary password won't work.",
    docURL: "https://help.yahoo.com/kb/SLN15241.html",
    domainMatchers: ["yahoo.com", "ymail.com", "rocketmail.com"],
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    authNote:
      "iCloud requires an app-specific password from appleid.apple.com → Sign-In and Security.",
    docURL: "https://support.apple.com/en-us/HT204397",
    domainMatchers: ["icloud.com", "me.com", "mac.com"],
  },
  {
    id: "proton",
    label: "ProtonMail (via Bridge)",
    imapHost: "127.0.0.1",
    imapPort: 1143,
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    authNote:
      "ProtonMail requires the desktop Bridge app running locally. Use the Bridge-generated password, not your Proton account password.",
    docURL: "https://proton.me/mail/bridge",
    domainMatchers: ["proton.me", "protonmail.com", "pm.me"],
  },
  {
    id: "generic",
    label: "Other (generic IMAP/SMTP)",
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 587,
    authNote:
      "Enter the IMAP and SMTP settings your provider publishes. Most modern providers require an app-specific password.",
    docURL: "",
    domainMatchers: [],
  },
];

// detectProviderFromEmail returns the preset that matches the email's
// domain, or the generic preset if no match is found. Used to auto-pick
// a sensible default when the user has already typed their email into
// the username field.
export function detectProviderFromEmail(email: string): EmailProviderPreset {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) {
    return EMAIL_PROVIDER_PRESETS[EMAIL_PROVIDER_PRESETS.length - 1]!;
  }
  const domain = email.slice(at + 1).toLowerCase();
  for (const preset of EMAIL_PROVIDER_PRESETS) {
    if (preset.domainMatchers.includes(domain)) {
      return preset;
    }
  }
  return EMAIL_PROVIDER_PRESETS[EMAIL_PROVIDER_PRESETS.length - 1]!;
}
