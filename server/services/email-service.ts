// SendGrid Email Service - Using Replit SendGrid Integration
// Email styling inspired by Vega by The Synozur Alliance
import sgMail from '@sendgrid/mail';

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
  
  const content = `
    <h1>Verify your email address</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p>Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the button below:</p>
    
    <div class="button-container">
      <a href="${verificationLink}" class="button">Verify Email Address</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">Or copy and paste this link into your browser:</p>
    <p class="link">${verificationLink}</p>
    
    <p class="muted" style="margin-top: 24px;">This verification link will expire in 24 hours.</p>
    
    <p>Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">If you didn't create an account with Orbit, you can safely ignore this email.</p>
  `;

  const text = `
Hi ${name},

Thank you for signing up for Orbit! To complete your registration and set up your organization, please verify your email address by clicking the link below:

${verificationLink}

This verification link will expire in 24 hours.

Once verified, you'll be set up as the administrator for your organization and can start tracking competitors and generating AI-powered insights.

If you didn't create an account with Orbit, you can safely ignore this email.

© ${new Date().getFullYear()} The Synozur Alliance, LLC. All rights reserved.
  `;

  return sendEmail({
    to: email,
    subject: 'Verify your email address - Orbit by Synozur',
    html: wrapEmailContent(content),
    text
  });
}

export async function sendWelcomeEmail(email: string, name: string, companyName: string): Promise<boolean> {
  const content = `
    <h1>Welcome to Orbit, ${name}!</h1>
    
    <p>Your email has been verified and <span class="highlight">${companyName}</span> is now set up on Orbit. As the organization administrator, you can invite team members and manage your competitive intelligence.</p>
    
    <p style="color: #ffffff; font-weight: 500; margin-top: 28px;">Here's what you can do next:</p>
    
    <div class="feature-list">
      <div class="feature">
        <div class="feature-title">1. Add Competitors</div>
        <p class="feature-desc">Enter competitor URLs and Orbit will automatically analyze their positioning and messaging.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">2. Upload Your Positioning Docs</div>
        <p class="feature-desc">Add your messaging guidelines, brand docs, or pitch decks for AI-powered comparison.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">3. Run AI Analysis</div>
        <p class="feature-desc">Let Claude analyze your positioning vs competitors and identify gaps and opportunities.</p>
      </div>
    </div>
    
    <div class="button-container">
      <a href="https://orbit.synozur.com/app" class="button">Get Started</a>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `Welcome to Orbit - ${companyName} is ready!`,
    html: wrapEmailContent(content),
    text: `Welcome to Orbit, ${name}! Your email has been verified and ${companyName} is now set up. Get started at https://orbit.synozur.com/app`
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
  
  const content = `
    <h1>You've been invited to join ${companyName} on Orbit</h1>
    
    <p><span class="highlight">${inviterName}</span> has invited you to join their team on Orbit, the AI-powered competitive intelligence platform.</p>
    
    <p>As a team member, you'll be able to:</p>
    
    <div class="feature-list">
      <div class="feature">
        <div class="feature-title">Track Competitors</div>
        <p class="feature-desc">Monitor competitor websites, social media, and messaging in real-time.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">Access AI Insights</div>
        <p class="feature-desc">Get AI-powered recommendations and gap analysis powered by Claude.</p>
      </div>
      
      <div class="feature">
        <div class="feature-title">Generate Reports</div>
        <p class="feature-desc">Create branded PDF reports for stakeholders and leadership.</p>
      </div>
    </div>
    
    <div class="button-container">
      <a href="${inviteLink}" class="button">Accept Invitation</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">Or copy and paste this link into your browser:</p>
    <p class="link">${inviteLink}</p>
    
    <p class="muted" style="margin-top: 24px;">This invitation link will expire in 7 days.</p>
  `;

  return sendEmail({
    to: email,
    subject: `${inviterName} invited you to join ${companyName} on Orbit`,
    html: wrapEmailContent(content),
    text: `${inviterName} has invited you to join ${companyName} on Orbit. Accept your invitation: ${inviteLink}`
  });
}

export async function sendPasswordResetEmail(
  email: string, 
  name: string, 
  resetToken: string,
  baseUrl: string
): Promise<boolean> {
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;
  
  const content = `
    <h1>Reset your password</h1>
    
    <p>Hi <span class="highlight">${name}</span>,</p>
    
    <p>We received a request to reset your password for your Orbit account. Click the button below to create a new password:</p>
    
    <div class="button-container">
      <a href="${resetLink}" class="button">Reset Password</a>
    </div>
    
    <div class="divider"></div>
    
    <p class="muted">Or copy and paste this link into your browser:</p>
    <p class="link">${resetLink}</p>
    
    <p class="muted" style="margin-top: 24px;">This link will expire in 1 hour for security reasons.</p>
    
    <p class="muted" style="font-size: 13px; margin-top: 32px;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
  `;

  return sendEmail({
    to: email,
    subject: 'Reset your password - Orbit by Synozur',
    html: wrapEmailContent(content),
    text: `Hi ${name}, Reset your Orbit password: ${resetLink}. This link expires in 1 hour.`
  });
}
