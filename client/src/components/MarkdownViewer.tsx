import React, { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface MarkdownViewerProps {
  url: string;
  className?: string;
  maxHeight?: string;
}

export default function MarkdownViewer({ url, className = "", maxHeight = "500px" }: MarkdownViewerProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load content");
        return res.text();
      })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [url]);

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
            <ol key={`list-${elements.length}`} className="list-decimal list-inside space-y-1 mb-4 text-muted-foreground text-sm">
              {listItems.map((item, i) => (
                <li key={i} className="leading-relaxed">{renderInline(item)}</li>
              ))}
            </ol>
          );
        } else {
          elements.push(
            <ul key={`list-${elements.length}`} className="list-disc list-inside space-y-1 mb-4 text-muted-foreground text-sm">
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
        const codeMatch = remaining.match(/`([^`]+)`/);
        const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
        const linkMatch = remaining.match(/\[(.+?)\]\((.+?)\)/);
        const checkboxChecked = remaining.match(/^\[x\]\s*/i);
        const checkboxUnchecked = remaining.match(/^\[\s*\]\s*/);

        const matches = [
          { match: codeMatch, type: 'code' },
          { match: boldMatch, type: 'bold' },
          { match: linkMatch, type: 'link' },
        ].filter(m => m.match).sort((a, b) => (a.match?.index || 0) - (b.match?.index || 0));

        if (checkboxChecked && remaining.startsWith('[x]')) {
          parts.push(<span key={key++} className="text-green-500 mr-1">✓</span>);
          remaining = remaining.slice(4);
        } else if (checkboxUnchecked && remaining.startsWith('[ ]')) {
          parts.push(<span key={key++} className="text-muted-foreground mr-1">○</span>);
          remaining = remaining.slice(4);
        } else if (matches.length > 0) {
          const first = matches[0];
          if (first.match!.index! > 0) {
            parts.push(<span key={key++}>{remaining.slice(0, first.match!.index)}</span>);
          }

          if (first.type === 'code') {
            parts.push(
              <code key={key++} className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">
                {first.match![1]}
              </code>
            );
          } else if (first.type === 'bold') {
            parts.push(<strong key={key++} className="text-foreground font-semibold">{first.match![1]}</strong>);
          } else if (first.type === 'link') {
            parts.push(
              <a
                key={key++}
                href={first.match![2]}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {first.match![1]}
                <ExternalLink size={10} />
              </a>
            );
          }
          remaining = remaining.slice(first.match!.index! + first.match![0].length);
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
          <h1 key={i} className="text-2xl font-bold text-foreground mb-2">
            {line.slice(2)}
          </h1>
        );
      } else if (line.startsWith("## ")) {
        flushList();
        elements.push(
          <h2 key={i} className="text-xl font-semibold text-foreground mt-6 mb-3">
            {line.slice(3)}
          </h2>
        );
      } else if (line.startsWith("### ")) {
        flushList();
        elements.push(
          <h3 key={i} className="text-lg font-semibold text-foreground mt-4 mb-2">
            {line.slice(4)}
          </h3>
        );
      } else if (line.startsWith("#### ")) {
        flushList();
        elements.push(
          <h4 key={i} className="text-base font-semibold text-foreground mt-3 mb-2">
            {line.slice(5)}
          </h4>
        );
      } else if (line.startsWith("---")) {
        flushList();
        elements.push(<Separator key={i} className="my-4" />);
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
          <p key={i} className="text-xs text-muted-foreground italic mb-3">
            {line.slice(1, -1)}
          </p>
        );
      } else {
        flushList();
        elements.push(
          <p key={i} className="text-muted-foreground leading-relaxed mb-3 text-sm">
            {renderInline(line)}
          </p>
        );
      }
    }

    flushList();
    return elements;
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-12 text-muted-foreground ${className}`}>
        Failed to load content
      </div>
    );
  }

  return (
    <ScrollArea className={className} style={{ maxHeight }}>
      <div className="pr-4">{renderMarkdown(content)}</div>
    </ScrollArea>
  );
}
