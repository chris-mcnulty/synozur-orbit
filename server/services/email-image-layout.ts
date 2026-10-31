/**
 * Inline constraints survive HTML-module pasting (where head CSS is stripped)
 * and width attributes constrain Outlook's Word-based renderer.
 */
export function constrainEmailImages(html: string): string {
  return html.replace(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, tag => {
    const styleMatch = tag.match(/\sstyle\s*=\s*(["'])(.*?)\1/i);
    const style = styleMatch?.[2] || "";
    const attributeWidth = tag.match(/\swidth\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+)(?=\s|\/?>))/i);
    const cssWidth = style.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)(px|%)?\s*(?:!important)?\s*(?=;|$)/i);
    const cssMaxWidth = style.match(/(?:^|;)\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*(?:!important)?\s*(?=;|$)/i);
    const widths = [560];
    if (attributeWidth) widths.push(Number(attributeWidth[1] || attributeWidth[2] || attributeWidth[3]));
    if (cssWidth && cssWidth[2] !== "%") widths.push(Number(cssWidth[1]));
    if (cssMaxWidth) widths.push(Number(cssMaxWidth[1]));
    const width = Math.max(1, Math.floor(Math.min(...widths.filter(n => n > 0))));
    const percentageWidth = cssWidth?.[2] === "%" && Number(cssWidth[1]) < 100;
    const displayWidth = percentageWidth ? `${Number(cssWidth![1])}%` : `${width}px`;
    const otherStyles = style.split(";").filter(rule =>
      rule.trim() && !/^\s*(?:width|max-width|height|max-height|min-width|min-height)\s*:/i.test(rule),
    ).join(";");
    let out = tag
      .replace(/\sstyle\s*=\s*(["']).*?\1/i, "")
      .replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    out = out.replace(/\s*\/?>$/, ` width="${width}" style="${otherStyles}${otherStyles ? ";" : ""}width:${displayWidth};max-width:${percentageWidth ? `${width}px` : "100%"};height:auto;" />`);
    return out;
  });
}
