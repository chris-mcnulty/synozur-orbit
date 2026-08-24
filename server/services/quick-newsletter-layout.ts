/**
 * Deterministic presentation for prompt-grounded Quick Generate newsletters.
 *
 * The AI returns plain text so it can be held to the user's prompt as its only
 * fact source. This renderer turns that exact text into the same table-based,
 * mobile-ready email shape used by the newsletter workflow without asking the
 * model to add visual sections, company information, or a footer.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeColor(value: string | null | undefined, fallback: string): string {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value?.trim() ?? "")
    ? value!.trim()
    : fallback;
}

function renderTextBlock(block: string, primaryColor: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";

  const isList = lines.every((line) => /^[-*•]\s+/.test(line));
  if (isList) {
    return `<ul style="margin:0;padding:0 0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;">
${lines.map((line) => `  <li style="margin:0 0 8px 0;">${escapeHtml(line.replace(/^[-*•]\s+/, ""))}</li>`).join("\n")}
</ul>`;
  }

  return `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#333333;">${lines
    .map(escapeHtml)
    .join("<br>")}</p>`;
}

/**
 * Build a bare email fragment (not a full document). Send/export paths wrap
 * generated email fragments with wrapResponsiveDocument, which keeps font
 * injection and responsive media rules in one established place.
 */
export function renderQuickNewsletterHtml(input: {
  subject: string;
  body: string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
}): string {
  const primaryColor = safeColor(input.primaryColor, "#810FFB");
  const secondaryColor = safeColor(input.secondaryColor, "#E60CB3");
  const blocks = input.body
    .trim()
    .split(/\n\s*\n/)
    .map((block) => renderTextBlock(block, primaryColor))
    .filter(Boolean);

  return `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:560px;margin:0 auto;table-layout:fixed;background-color:#ffffff;">
  <tr>
    <td bgcolor="${primaryColor}" style="padding:32px;font-family:Arial,Helvetica,sans-serif;background-color:${primaryColor};">
      <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.3;font-weight:700;color:#ffffff;">${escapeHtml(input.subject)}</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;border-top:4px solid ${secondaryColor};">
      ${blocks.join('\n      <div style="height:20px;line-height:20px;font-size:16px;">&nbsp;</div>\n      ')}
    </td>
  </tr>
</table>`;
}