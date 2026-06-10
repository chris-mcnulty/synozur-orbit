/**
 * Polaris podcast outline — shared house-format guidance (pure, no I/O).
 *
 * Polaris is Synozur's podcast. Episodes are recorded LIVE, so the deliverable
 * is a written outline (exported as a branded Word doc), never AI audio. Both
 * the brief-draft path (copywriter-service) and the repurpose path
 * (repurpose-service) generate the same house format from this single source,
 * so the two stay in lockstep. See docs/polaris-podcast-outline-format.md.
 */

export const POLARIS_OUTLINE_GUIDANCE = [
  "Write a Polaris podcast outline in Markdown, following Synozur's house format exactly. Polaris episodes are recorded LIVE, so this is a written outline for guest review, not a verbatim script and not audio.",
  "",
  "Fixed facts — reuse verbatim, do not invent alternatives:",
  "- Host: Chris McNulty, Chief Technology Officer, Synozur.",
  '- Show name: Polaris (the spoken intro sometimes calls it "Polaris Pathways").',
  "- Show page: polaris.synozur.com · Email: polaris@synozur.com · Events page: synozur.com/events",
  '- Synozur boilerplate (use when explaining Synozur): "Synozur, the transformation company, reimagines business for our clients, navigating strategies and leadership culture with ease."',
  "- Production credits (in the outro): produced with help from Riverside.fm; theme song \"Alternative Dream\" courtesy of Adobe; additional music and sound by Indie Guy Records; graphic design by Josh Brantley.",
  '- Sign-off (end with this exactly): "I\'m Chris McNulty, and this has been Polaris, a show that charts the course for business and technology transformation from Synozur. Learn more at synozur.com. See you next time. Keep following your North Star."',
  "",
  "Header block (render first, before the sections):",
  "- A level-1 heading: Polaris Podcast Outline",
  "- Guest: name, title, company",
  "- Episode Title: the episode title",
  "- Prepared {today's date}  ·  Draft for guest review",
  "",
  "Section order (use these as headings, in this order):",
  '1. Cold Open — a scripted host hook monologue. Open with "From Synozur, this is Polaris. I\'m Chris McNulty." Set up the episode\'s central tension and end on "This is Polaris." A [GRAPHIC: ...] production cue is welcome.',
  "2. Intro — four beats: (a) Chris welcomes the audience (\"Welcome to Polaris Pathways. I'm your host, Chris McNulty, Chief Technology Officer at Synozur.\"); (b) explain Synozur using the boilerplate; (c) introduce the guest with a short bio paragraph; (d) transition: \"He'll join us in a few minutes, but first…\"",
  "3. Trends — define the key terms and data points with cited stats; note that the reading list / references go in the show notes. End with a handoff to bring the guest in.",
  "4. Topic of the Day — {episode theme}, with these sub-beats:",
  "   - Introduction: welcome the guest on air.",
  '   - Warm-up: "Question: Where are you calling from today?" followed by "Suggested Answer:".',
  "   - Interview: a series of Question / Suggested Answer pairs. Questions are prepped, conversational, and reference the guest's story; Suggested Answers are short prompts the guest can review before recording. Write 6-10 pairs.",
  "   - Personal Impact: a Question asking for a recent book/film/song/etc. with personal meaning (outside business and tech), plus a Suggested Answer.",
  "   - Staying in Touch: a Question on how the audience can follow the guest, plus a Suggested Answer.",
  "   - Closing: host recaps the guest and their latest news; guest thanks.",
  '5. Transition line: "We\'ll be right back…"',
  "6. Events — 2-4 upcoming events with dates/locations; point to the show notes, the Synozur blog, and synozur.com/events; invite event submissions.",
  "7. Coming Soon — a teaser for the next episode/guest. Include a [Confirm next-episode teaser before final recording.] cue.",
  "8. Outro — wrap, thank the guest, give the show page (polaris.synozur.com) and feedback email (polaris@synozur.com), the subscribe/rate/review ask, the production credits, and the standard sign-off.",
  "",
  "Conventions:",
  '- Interview content is written as "Question:" / "Suggested Answer:" pairs — a guest-review draft, not a verbatim script.',
  "- Use bracketed cues [GRAPHIC: ...], [Confirm ...], and parenthetical (Note: ...) to mark production/editorial to-dos.",
  "- Tone: warm, intelligent, plain-spoken, with light personal and cultural touches.",
  "- Also include, near the top under the header, a short \"Suggested topics\" list (3-5 bullets) drawn from the source material so the host can steer the conversation.",
].join("\n");

/**
 * The guest block appended to the generation prompt. When the user supplies a
 * guest, that guest overrides any AI suggestion and must be used verbatim
 * throughout. When blank, the model suggests a fitting guest and uses it
 * consistently.
 */
export function polarisGuestBlock(guest?: string | null): string {
  const g = (guest ?? "").trim();
  if (g) {
    return [
      "## Guest (supplied by the user)",
      "Use this exact guest throughout the outline. Do NOT invent a different guest or change their details. If only a name is given, you may infer a plausible title/company only if needed for the bio, but keep the supplied details intact.",
      g,
    ].join("\n");
  }
  return [
    "## Guest (none supplied — suggest one)",
    "No guest was provided. Suggest a single fitting guest for this episode — a real-sounding name, title, and company relevant to the topic — and use that same suggested guest consistently in the header block and throughout the outline. In the header's Guest line, append \"(suggested)\" so the team knows it is a placeholder to confirm or replace.",
  ].join("\n");
}
