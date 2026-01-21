// SendGrid Email Service - Using Replit SendGrid Integration
// Email styling inspired by Vega by The Synozur Alliance
// All email copy is centralized in server/config/email-copy.ts
import sgMail from '@sendgrid/mail';
import {
  EMAIL_CONFIG,
  VERIFICATION_EMAIL,
  WELCOME_EMAIL,
  TEAM_INVITE_EMAIL,
  USER_PROVISIONED_EMAIL,
  PASSWORD_RESET_EMAIL,
  TRIAL_REMINDER_EMAILS,
  WEEKLY_DIGEST_EMAIL,
  COMPETITOR_ALERT_EMAIL,
} from '../config/email-copy';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=sendgrid',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key || !connectionSettings.settings.from_email)) {
    throw new Error('SendGrid not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

async function getUncachableSendGridClient() {
  const { apiKey, email } = await getCredentials();
  sgMail.setApiKey(apiKey);
  return {
    client: sgMail,
    fromEmail: email
  };
}

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableSendGridClient();
    
    await client.send({
      to: options.to,
      from: fromEmail,
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
    });
    
    console.log(`Email sent successfully to ${options.to}`);
    return true;
  } catch (error: any) {
    console.error('Failed to send email:', error.message);
    return false;
  }
}

// Standard email header image URL - from centralized config
const EMAIL_HEADER_IMAGE_URL = EMAIL_CONFIG.branding.headerImageUrl;

// Common email template wrapper with Vega-inspired Synozur branding
export function wrapEmailContent(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
      background-color: #0f0f0f; 
      color: #ffffff; 
      margin: 0; 
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .email-wrapper {
      background-color: #0f0f0f;
      padding: 40px 20px;
    }
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background: linear-gradient(180deg, #1a1a2e 0%, #16162a 100%);
      border-radius: 16px; 
      overflow: hidden;
      border: 1px solid rgba(129, 15, 251, 0.2);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    }
    .header-image {
      width: 100%;
      display: block;
      height: auto;
    }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%);
      padding: 32px 40px;
      text-align: center;
      border-bottom: 1px solid rgba(129, 15, 251, 0.15);
    }
    .header-logo {
      display: inline-block;
    }
    .logo-orbit {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #818CF8 0%, #A78BFA 50%, #C084FC 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin: 0;
      letter-spacing: -0.5px;
    }
    .logo-tagline {
      color: #6B7280;
      font-size: 12px;
      margin: 6px 0 0 0;
      letter-spacing: 0.5px;
    }
    .content { 
      padding: 40px; 
    }
    h1 { 
      color: #ffffff; 
      font-size: 24px; 
      font-weight: 600;
      margin: 0 0 24px 0; 
      line-height: 1.3;
    }
    p { 
      color: #9CA3AF; 
      line-height: 1.7; 
      margin: 0 0 20px 0;
      font-size: 15px;
    }
    .button-container {
      text-align: center;
      margin: 32px 0;
    }
    .button { 
      display: inline-block; 
      background: linear-gradient(135deg, #818CF8 0%, #A78BFA 50%, #C084FC 100%);
      color: #ffffff !important; 
      text-decoration: none; 
      padding: 16px 36px; 
      border-radius: 10px; 
      font-weight: 600; 
      font-size: 15px;
      letter-spacing: 0.3px;
      transition: all 0.2s ease;
      box-shadow: 0 4px 14px rgba(129, 15, 251, 0.35);
    }
    .button:hover { 
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(129, 15, 251, 0.45);
    }
    .feature-list {
      margin: 28px 0;
    }
    .feature { 
      background: rgba(129, 15, 251, 0.08);
      border: 1px solid rgba(129, 15, 251, 0.15);
      padding: 20px; 
      border-radius: 12px; 
      margin-bottom: 14px; 
    }
    .feature-title { 
      color: #ffffff; 
      font-weight: 600; 
      margin: 0 0 6px 0;
      font-size: 15px;
    }
    .feature-desc { 
      color: #9CA3AF; 
      font-size: 14px; 
      margin: 0;
      line-height: 1.5;
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent 0%, rgba(129, 15, 251, 0.3) 50%, transparent 100%);
      margin: 32px 0;
    }
    .footer { 
      padding: 28px 40px;
      background: #0f0f1a;
      border-top: 1px solid rgba(129, 15, 251, 0.1);
      text-align: center;
    }
    .footer p {
      color: #6B7280;
      font-size: 12px;
      margin: 0 0 8px 0;
    }
    .footer a {
      color: #818CF8;
      text-decoration: none;
    }
    .link { 
      color: #818CF8;
      word-break: break-all;
      font-size: 13px;
    }
    .highlight {
      color: #ffffff;
      font-weight: 500;
    }
    .muted {
      color: #6B7280;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="container">
      <img src="${EMAIL_HEADER_IMAGE_URL}" alt="Synozur Alliance" class="header-image" />
      <div class="header">
        <div class="header-logo">
          <h2 class="logo-orbit">Orbit</h2>
          <p class="logo-tagline">by The Synozur Alliance</p>
        </div>
      </div>
      <div class="content">
        ${content}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.</p>
        <p><a href="https://orbit.synozur.com">orbit.synozur.com</a></p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export async function sendVerificationEmail(
  email: string, 
  name: string, 
  verificationToken: string,
  baseUrl: string
): Promise<boolean> {
  const verificationLink = `${baseUrl}/api/auth/verify-email?token=${verificationToken}`;
  const copy = VERIFICATION_EMAIL;
  
  const content = `
    <h1>${copy.heading}</h1>
    
    <p>${copy.greeting(name)}</p>
    
    <p>${copy.body}</p>
    
    <div class="button-container">
      <a href="${verificationLink}" class="button">${copy.buttonText}</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">${copy.linkInstructions}</p>
    <p class="link">${verificationLink}</p>
    
    <p class="muted" style="margin-top: 24px;">${copy.expiryNotice}</p>
    
    <p>${copy.postVerification}</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">${copy.disclaimer}</p>
  `;

  return sendEmail({
    to: email,
    subject: copy.subject,
    html: wrapEmailContent(content),
    text: copy.plainText(name, verificationLink)
  });
}

export async function sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean> {
  const copy = WELCOME_EMAIL;
  
  const featuresHtml = copy.features.map(f => `
    <div class="feature">
      <div class="feature-title">${f.title}</div>
      <p class="feature-desc">${f.description}</p>
    </div>
  `).join('');
  
  const content = `
    <h1>${copy.heading(name)}</h1>
    
    <p>${copy.body(companyName)}</p>
    
    <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${copy.nextStepsIntro}</p>
    
    <div class="feature-list">
      ${featuresHtml}
    </div>
    
    <div class="button-container">
      <a href="${EMAIL_CONFIG.branding.appUrl}" class="button">${copy.buttonText}</a>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: copy.subject(companyName),
    html: wrapEmailContent(content),
    text: copy.plainText(name, companyName)
  });
}

export async function sendTeamInviteEmail(
  email: string, 
  inviterName: string, 
  companyName: string, 
  inviteToken: string,
  baseUrl: string
): Promise<boolean> {
  const inviteLink = `${baseUrl}/accept-invite?token=${inviteToken}`;
  const copy = TEAM_INVITE_EMAIL;
  
  const featuresHtml = copy.features.map(f => `
    <div class="feature">
      <div class="feature-title">${f.title}</div>
      <p class="feature-desc">${f.description}</p>
    </div>
  `).join('');
  
  const content = `
    <h1>${copy.heading(companyName)}</h1>
    
    <p>${copy.body(inviterName)}</p>
    
    <p>${copy.capabilitiesIntro}</p>
    
    <div class="feature-list">
      ${featuresHtml}
    </div>
    
    <div class="button-container">
      <a href="${inviteLink}" class="button">${copy.buttonText}</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">${copy.linkInstructions}</p>
    <p class="link">${inviteLink}</p>
    
    <p class="muted" style="margin-top: 24px;">${copy.expiryNotice}</p>
  `;

  return sendEmail({
    to: email,
    subject: copy.subject(inviterName, companyName),
    html: wrapEmailContent(content),
    text: copy.plainText(inviterName, companyName, inviteLink)
  });
}

export async function sendUserProvisionedWelcomeEmail(
  email: string, 
  name: string, 
  companyName: string,
  role: string,
  addedByName: string,
  baseUrl: string
): Promise<boolean> {
  const loginLink = `${baseUrl}/auth/signin`;
  const guideLink = `${baseUrl}/app/guide`;
  const copy = USER_PROVISIONED_EMAIL;
  
  const featuresHtml = copy.features.map(f => `
    <div class="feature">
      <div class="feature-title">${f.title}</div>
      <p class="feature-desc">${f.description}</p>
    </div>
  `).join('');
  
  const content = `
    <h1>${copy.heading}</h1>
    
    <p>${copy.greeting(name)}</p>
    
    <p>${copy.body(addedByName, companyName, role)}</p>
    
    <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${copy.gettingStartedTitle}</p>
    
    <p>${copy.gettingStartedBody}</p>
    
    <div class="button-container">
      <a href="${loginLink}" class="button">${copy.buttonText}</a>
    </div>
    
    <div class="divider"></div>
    
    <p style="color: #ffffff; font-weight: 500;">${copy.capabilitiesTitle}</p>
    
    <div class="feature-list">
      ${featuresHtml}
    </div>
    
    <div class="divider"></div>
    
    <p>${copy.helpText(guideLink)}</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">${copy.disclaimer}</p>
  `;

  return sendEmail({
    to: email,
    subject: copy.subject(companyName),
    html: wrapEmailContent(content),
    text: copy.plainText(name, addedByName, companyName, role, loginLink, guideLink)
  });
}

export async function sendPasswordResetEmail(
  email: string, 
  name: string, 
  resetToken: string,
  baseUrl: string
): Promise<boolean> {
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  const copy = PASSWORD_RESET_EMAIL;
  
  const content = `
    <h1>${copy.heading}</h1>
    
    <p>${copy.greeting(name)}</p>
    
    <p>${copy.body}</p>
    
    <div class="button-container">
      <a href="${resetLink}" class="button">${copy.buttonText}</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">${copy.linkInstructions}</p>
    <p class="link">${resetLink}</p>
    
    <p class="muted" style="margin-top: 24px;">${copy.expiryNotice}</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">${copy.disclaimer}</p>
  `;

  return sendEmail({
    to: email,
    subject: copy.subject,
    html: wrapEmailContent(content),
    text: copy.plainText(name, resetLink)
  });
}

// Trial Reminder Email Templates
// 60-day trial with reminders at: day 7, day 30, day 46 (14 left), day 53 (7 left), day 57 (3 left), day 59 (1 left), day 60 (expired)
// Copy is centralized in server/config/email-copy.ts

export type TrialReminderType = 'day7' | 'day30' | 'day46' | 'day53' | 'day57' | 'day59' | 'day60';

interface TrialReminderParams {
  email: string;
  name: string;
  companyName: string;
  daysRemaining: number;
  baseUrl: string;
}

function buildFeaturesHtml(features: Array<{title: string, description: string}>): string {
  if (!features || features.length === 0) return '';
  return `
    <div class="feature-list">
      ${features.map(f => `
        <div class="feature">
          <div class="feature-title">${f.title}</div>
          <p class="feature-desc">${f.description}</p>
        </div>
      `).join('')}
    </div>
  `;
}

export async function sendTrialReminderEmail(
  params: TrialReminderParams,
  reminderType: TrialReminderType
): Promise<boolean> {
  const { email, name, companyName, daysRemaining, baseUrl } = params;
  const loginLink = `${baseUrl}/auth`;
  const contactEmail = EMAIL_CONFIG.branding.supportEmail;
  
  const templates = TRIAL_REMINDER_EMAILS;
  const template = templates[reminderType];
  
  let subject: string;
  let heading: string;
  let bodyContent: string;
  let includeContactCta: boolean = template.includeContactCta;
  
  switch (reminderType) {
    case 'day7': {
      const t = templates.day7;
      subject = t.subject(name);
      heading = t.heading;
      const featuresHtml = buildFeaturesHtml(t.features);
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro}</p>
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${t.tipsTitle}</p>
        ${featuresHtml}
        <p style="margin-top: 24px;">${t.closing(daysRemaining)}</p>
      `;
      break;
    }
      
    case 'day30': {
      const t = templates.day30;
      subject = t.subject(name);
      heading = t.heading;
      const featuresHtml = buildFeaturesHtml(t.features);
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro}</p>
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${t.tipsTitle}</p>
        ${featuresHtml}
        <p style="margin-top: 24px;">${t.closing(daysRemaining)}</p>
      `;
      break;
    }
      
    case 'day46': {
      const t = templates.day46;
      subject = t.subject;
      heading = t.heading;
      const featuresHtml = buildFeaturesHtml(t.features);
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro(companyName)}</p>
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${t.tipsTitle}</p>
        ${featuresHtml}
      `;
      break;
    }
      
    case 'day53': {
      const t = templates.day53;
      subject = t.subject;
      heading = t.heading;
      const featuresHtml = buildFeaturesHtml(t.features);
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro(companyName)}</p>
        <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${t.tipsTitle}</p>
        ${featuresHtml}
      `;
      break;
    }
      
    case 'day57': {
      const t = templates.day57;
      subject = t.subject;
      heading = t.heading;
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro(companyName)}</p>
        <p style="margin-top: 24px;">${t.closing}</p>
      `;
      break;
    }
      
    case 'day59': {
      const t = templates.day59;
      subject = t.subject;
      heading = t.heading;
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro(companyName)}</p>
        <p style="margin-top: 24px;">${t.postTrialNote}</p>
        <p style="margin-top: 24px;">${t.closing}</p>
      `;
      break;
    }
      
    case 'day60': {
      const t = templates.day60;
      subject = t.subject;
      heading = t.heading;
      const featuresHtml = buildFeaturesHtml(t.features);
      bodyContent = `
        <p>${t.greeting(name)}</p>
        <p>${t.intro(companyName)}</p>
        <p style="margin-top: 24px;">${t.transitionNote}</p>
        ${featuresHtml}
        <p style="margin-top: 24px;">${t.closing}</p>
      `;
      break;
    }
  }
  
  const contactCtaCopy = templates.contactCta;
  const contactCtaHtml = includeContactCta ? `
    <div class="divider"></div>
    <p style="color: #ffffff; font-weight: 500;">${contactCtaCopy.title}</p>
    <p>${contactCtaCopy.body}</p>
    <p style="margin-top: 16px;">${contactCtaCopy.description(contactEmail)}</p>
  ` : '';
  
  const content = `
    <h1>${heading}</h1>
    ${bodyContent}
    ${contactCtaHtml}
    <div class="button-container">
      <a href="${loginLink}" class="button">${templates.loginButton}</a>
    </div>
    <p class="muted" style="font-size: 13px; margin-top: 32px;">${templates.footerContact(contactEmail)}</p>
  `;
  
  const text = templates.plainText.general(name, heading, daysRemaining, companyName, loginLink, contactEmail, includeContactCta);

  return sendEmail({
    to: email,
    subject,
    html: wrapEmailContent(content),
    text
  });
}

// Weekly Digest Email
interface ActivitySummary {
  competitorName: string;
  type: string;
  description: string;
  summary?: string;
}

interface WeeklyDigestParams {
  email: string;
  name: string;
  companyName: string;
  activities: ActivitySummary[];
  baseUrl: string;
}

export async function sendWeeklyDigestEmail(params: WeeklyDigestParams): Promise<boolean> {
  const { email, name, companyName, activities, baseUrl } = params;
  const copy = WEEKLY_DIGEST_EMAIL;
  const loginLink = `${baseUrl}/app/activity`;
  const settingsLink = `${baseUrl}/app/settings`;
  
  const hasChanges = activities.length > 0;
  
  // Build activity list HTML
  let activitiesHtml = '';
  if (hasChanges) {
    activitiesHtml = `
      <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${copy.changesFoundHeading(activities.length)}</p>
      <div class="feature-list">
        ${activities.slice(0, 10).map(act => {
          const typeLabel = act.type === 'change' ? copy.websiteChangeLabel :
                           act.type === 'social_update' ? copy.socialUpdateLabel :
                           act.type === 'blog_post' ? copy.blogPostLabel : act.type;
          return `
            <div class="feature">
              <div class="feature-title">${act.competitorName} - ${typeLabel}</div>
              <p class="feature-desc">${act.summary || act.description}</p>
            </div>
          `;
        }).join('')}
      </div>
      ${activities.length > 10 ? `<p class="muted" style="margin-top: 16px;">...and ${activities.length - 10} more updates</p>` : ''}
    `;
  } else {
    activitiesHtml = `
      <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">${copy.noChangesHeading}</p>
      <p class="muted">${copy.noChangesMessage}</p>
    `;
  }
  
  const content = `
    <h1>${copy.heading}</h1>
    
    <p>${copy.greeting(name)}</p>
    
    <p>${copy.intro}</p>
    
    ${activitiesHtml}
    
    <div class="button-container">
      <a href="${loginLink}" class="button">${copy.buttonText}</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted" style="font-size: 12px;">${copy.footerMessage}</p>
    <p class="muted" style="font-size: 12px;"><a href="${settingsLink}" class="link">${copy.unsubscribeText}</a></p>
  `;
  
  // Plain text summary
  const changesSummary = hasChanges 
    ? activities.slice(0, 10).map(a => `- ${a.competitorName}: ${a.description}`).join('\n')
    : copy.noChangesMessage;
  
  const text = copy.plainText(name, companyName, changesSummary, loginLink, settingsLink);

  return sendEmail({
    to: email,
    subject: copy.subject(companyName),
    html: wrapEmailContent(content),
    text
  });
}
