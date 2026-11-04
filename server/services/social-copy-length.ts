import twitterText from "twitter-text";

export function isTwitterPlatform(platform: string): boolean {
  return ["twitter", "x"].includes(platform.toLowerCase());
}

/**
 * Match the X publisher's final body, including its two-newline tag separator.
 * X weights URLs at 23 characters and emoji/CJK per twitter-text, not JS length.
 */
export function socialCopyLength(content: string, platform: string, hashtags: readonly string[] = []): number {
  if (!isTwitterPlatform(platform)) return content.length;
  const finalText = hashtags.length
    ? `${content}\n\n${hashtags.map(tag => tag.startsWith("#") ? tag : `#${tag}`).join(" ")}`
    : content;
  return twitterText.parseTweet(finalText).weightedLength;
}
