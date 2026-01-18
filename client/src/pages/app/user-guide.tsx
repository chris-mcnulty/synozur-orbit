import React, { useEffect, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import AppLayout from "@/components/layout/AppLayout";

export default function UserGuidePage() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/content/user_guide.md")
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        setContent("# User Guide\n\nUnable to load the user guide. Please try again later.");
        setLoading(false);
      });
  }, []);

  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    const elements: React.ReactElement[] = [];
    let inList = false;
    let listItems: string[] = [];
    let listType: "ul" | "ol" = "ul";

    const flushList = () => {
      if (listItems.length > 0) {
        if (listType === "ol") {
          elements.push(
            <ol key={`list-${elements.length}`} className="list-decimal list-inside space-y-2 mb-4 text-muted-foreground">
              {listItems.map((item, i) => (
                <li key={i} className="leading-relaxed">{renderInline(item)}</li>
              ))}
            </ol>
          );
        } else {
          elements.push(
            <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-2 mb-4 text-muted-foreground">
              {listItems.map((item, i) => (
                <li key={i} className="leading-relaxed">{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        listItems = [];
        inList = false;
      }
    };

    const renderInline = (text: string): React.ReactNode => {
      const parts: React.ReactNode[] = [];
      let remaining = text;
      let key = 0;

      while (remaining.length > 0) {
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        const linkMatch = remaining.match(/\[(.+?)\]\((.+?)\)/);

        if (boldMatch && (!linkMatch || boldMatch.index! < linkMatch.index!)) {
          if (boldMatch.index! > 0) {
            parts.push(<span key={key++}>{remaining.slice(0, boldMatch.index)}</span>);
          }
          parts.push(<strong key={key++} className="text-foreground font-semibold">{boldMatch[1]}</strong>);
          remaining = remaining.slice(boldMatch.index! + boldMatch[0].length);
        } else if (linkMatch) {
          if (linkMatch.index! > 0) {
            parts.push(<span key={key++}>{remaining.slice(0, linkMatch.index)}</span>);
          }
          parts.push(
            <a
              key={key++}
              href={linkMatch[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              {linkMatch[1]}
              <ExternalLink size={12} />
            </a>
          );
          remaining = remaining.slice(linkMatch.index! + linkMatch[0].length);
        } else {
          parts.push(<span key={key++}>{remaining}</span>);
          break;
        }
      }

      return parts.length === 1 ? parts[0] : <>{parts}</>;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("# ")) {
        flushList();
        elements.push(
          <h1 key={i} className="text-3xl font-bold text-foreground mb-2">
            {line.slice(2)}
          </h1>
        );
      } else if (line.startsWith("## ")) {
        flushList();
        elements.push(
          <h2 key={i} className="text-2xl font-semibold text-foreground mt-8 mb-4">
            {line.slice(3)}
          </h2>
        );
      } else if (line.startsWith("### ")) {
        flushList();
        elements.push(
          <h3 key={i} className="text-xl font-semibold text-foreground mt-6 mb-3">
            {line.slice(4)}
          </h3>
        );
      } else if (line.startsWith("---")) {
        flushList();
        elements.push(<Separator key={i} className="my-6" />);
      } else if (line.match(/^\d+\.\s/)) {
        if (!inList || listType !== "ol") {
          flushList();
          listType = "ol";
        }
        inList = true;
        listItems.push(line.replace(/^\d+\.\s/, ""));
      } else if (line.startsWith("- ")) {
        if (!inList || listType !== "ul") {
          flushList();
          listType = "ul";
        }
        inList = true;
        listItems.push(line.slice(2));
      } else if (line.trim() === "") {
        flushList();
      } else if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
        flushList();
        elements.push(
          <p key={i} className="text-sm text-muted-foreground italic mb-4">
            {line.slice(1, -1)}
          </p>
        );
      } else {
        flushList();
        elements.push(
          <p key={i} className="text-muted-foreground leading-relaxed mb-4">
            {renderInline(line)}
          </p>
        );
      }
    }

    flushList();
    return elements;
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">User Guide</h1>
            <p className="text-muted-foreground text-sm">Learn how to get the most out of Orbit</p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen size={18} className="text-primary" />
              Orbit Documentation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="p-6 max-w-none prose-invert">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-pulse text-muted-foreground">Loading guide...</div>
                  </div>
                ) : (
                  <div className="space-y-0">{renderMarkdown(content)}</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
