import type { BriefingData } from "./intelligence-briefing-service";

export interface PodcastLine {
  speaker: "A" | "B";
  text: string;
}

export interface PodcastScript {
  lines: PodcastLine[];
  estimatedDurationMinutes: number;
}

export function generatePodcastScript(briefingData: BriefingData): PodcastScript {
  const lines: PodcastLine[] = [];

  const add = (speaker: "A" | "B", text: string) => {
    lines.push({ speaker, text });
  };

  add("A", `Welcome back to the Market Intelligence Briefing. I'm here with my co-host and we've got a packed ${briefingData.periodLabel} report to break down for you today.`);
  add("B", `Yeah, this one's interesting. We tracked ${briefingData.signalDigest.totalSignals} signal${briefingData.signalDigest.totalSignals !== 1 ? "s" : ""} across the competitive landscape, and there are some real takeaways here. Let's dive in.`);

  if (briefingData.executiveSummary) {
    const paragraphs = briefingData.executiveSummary.split(/\n\n+/).filter(Boolean);
    add("A", `Alright, let's start with the big picture. ${paragraphs[0]}`);
    if (paragraphs.length > 1) {
      add("B", `And to add to that - ${paragraphs[1]}`);
    }
    if (paragraphs.length > 2) {
      add("A", `Exactly. ${paragraphs[2]}`);
    }
  }

  if (briefingData.keyThemes.length > 0) {
    add("B", `So let's talk about the key themes we're seeing. There are ${briefingData.keyThemes.length} major patterns worth highlighting.`);

    for (let i = 0; i < Math.min(briefingData.keyThemes.length, 4); i++) {
      const theme = briefingData.keyThemes[i];
      const significance = theme.significance === "high" ? "really significant" : theme.significance === "medium" ? "notable" : "worth watching";
      if (i % 2 === 0) {
        add("A", `The ${i === 0 ? "first" : "next"} theme is "${theme.title}" - and this one is ${significance}. ${theme.description}`);
        if (theme.competitors.length > 0) {
          add("B", `Right, and we're seeing this from ${theme.competitors.join(", ")}. That's telling.`);
        }
      } else {
        add("B", `Another pattern we noticed is "${theme.title}." ${theme.description}`);
        if (theme.competitors.length > 0) {
          add("A", `Interesting - that involves ${theme.competitors.join(" and ")}. What do you make of that?`);
          add("B", `It suggests they're moving in a similar direction, which could reshape the competitive dynamics here.`);
        }
      }
    }
  }

  if (briefingData.competitorMovements.length > 0) {
    add("A", `Now let's get into the specific competitor movements. This is where things get really tactical.`);

    for (let i = 0; i < Math.min(briefingData.competitorMovements.length, 4); i++) {
      const mov = briefingData.competitorMovements[i];
      const threatDesc = mov.threatLevel === "high" ? "a high-threat" : mov.threatLevel === "medium" ? "a medium-threat" : "a lower-threat";
      if (i % 2 === 0) {
        add("B", `Let's look at ${mov.name}. We're classifying them as ${threatDesc} mover right now.`);
        if (mov.signals.length > 0) {
          const topSignals = mov.signals.slice(0, 3).join(". Also, ");
          add("A", `What did we see specifically? Well - ${topSignals}.`);
        }
        add("B", `And the interpretation here is: ${mov.interpretation}`);
      } else {
        add("A", `Moving on to ${mov.name} - ${threatDesc} player to watch.`);
        if (mov.signals.length > 0) {
          add("B", `The signals we're picking up: ${mov.signals.slice(0, 2).join(", and ")}.`);
        }
        add("A", `Our read on this? ${mov.interpretation}`);
      }
    }
  }

  if (briefingData.riskAlerts.length > 0) {
    add("B", `Before we get to action items, we need to flag some risk alerts.`);

    for (let i = 0; i < Math.min(briefingData.riskAlerts.length, 3); i++) {
      const risk = briefingData.riskAlerts[i];
      const severityWord = risk.severity === "critical" ? "critical" : risk.severity === "warning" ? "a warning-level" : "something to watch";
      if (i % 2 === 0) {
        add("A", `This one is ${severityWord}: "${risk.title}." ${risk.description}`);
      } else {
        add("B", `Also flagging: "${risk.title}." ${risk.description}`);
      }
    }
  }

  if (briefingData.actionItems.length > 0) {
    add("A", `Alright, let's wrap up with the recommended actions. What should teams actually do with all this?`);

    for (let i = 0; i < Math.min(briefingData.actionItems.length, 5); i++) {
      const item = briefingData.actionItems[i];
      const urgencyWord = item.urgency === "immediate" ? "right away" : item.urgency === "this_week" ? "this week" : item.urgency === "this_month" ? "this month" : "on your radar";
      if (i % 2 === 0) {
        add("B", `Number ${i + 1}: "${item.title}" - and this needs attention ${urgencyWord}. ${item.description}`);
      } else {
        add("A", `Next up: "${item.title}." Timing-wise, get this done ${urgencyWord}. ${item.description}`);
      }
    }
  }

  let wordCount = lines.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0);
  const targetWords = 1500;
  if (wordCount < targetWords && briefingData.keyThemes.length > 0) {
    add("A", `Let's take a step back and think about the broader strategic implications here. When you look at these themes together, there's a pattern forming.`);
    add("B", `Absolutely. The convergence of these signals tells us the market isn't just shifting incrementally - there are structural changes underway that could redefine competitive positioning.`);
    add("A", `Right. And for teams watching this space, the question isn't just what's happening now, but what these moves signal about where the market is headed six to twelve months from now.`);
    add("B", `That forward-looking perspective is crucial. The companies that act on these signals early will have a significant advantage.`);
    wordCount = lines.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0);
  }

  add("B", `That's a wrap for this ${briefingData.periodLabel.toLowerCase()} briefing. Some real movement to keep an eye on.`);
  add("A", `Absolutely. The full written briefing has all the details and data behind what we discussed today. Until next time, stay sharp out there.`);
  add("B", `See you next week.`);

  wordCount = lines.reduce((sum, line) => sum + line.text.split(/\s+/).length, 0);
  const estimatedDurationMinutes = Math.max(5, Math.round(wordCount / 150));

  return { lines, estimatedDurationMinutes };
}
