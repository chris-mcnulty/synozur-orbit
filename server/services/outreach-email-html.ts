/** Outlook needs an HTML body to retain rich signatures inserted by the seller.
 * Stored/editor copy remains plain text; never interpret generated copy as HTML.
 */
export function outreachEmailHtml(body: string): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]!));
  const linkify = (text: string) => {
    const pattern = /https?:\/\/[^\s<>"']+/gi;
    let html = "", offset = 0;
    for (const match of text.matchAll(pattern)) {
      let url = match[0].replace(/[.,;:!?]+$/, "");
      // Sentence parentheses must not become part of a booking URL, but balanced
      // parentheses inside a URL remain valid.
      let extraClosers = [...url].filter(c => c === ")").length - [...url].filter(c => c === "(").length;
      while (url.endsWith(")") && extraClosers-- > 0) url = url.slice(0, -1);
      html += escape(text.slice(offset, match.index));
      html += `<a href="${escape(url)}">${escape(url)}</a>`;
      offset = match.index! + url.length;
    }
    return html + escape(text.slice(offset));
  };
  const paragraphs = body.replace(/\r\n?/g, "\n").trim().split(/\n[ \t]*\n+/)
    .map(paragraph => `<p style="margin:0 0 12px 0;">${linkify(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">${paragraphs}</div>`;
}
