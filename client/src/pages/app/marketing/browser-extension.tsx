import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Chrome, Puzzle, ToggleRight, FolderOpen, Globe, Settings, CheckCircle2, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AppLayout from "@/components/layout/AppLayout";

function StepIllustration({ step }: { step: number }) {
  const common = "w-full rounded-lg border bg-muted/30 p-4 flex items-center justify-center";
  switch (step) {
    case 1:
      return (
        <div className={common} data-testid={`illustration-step-${step}`}>
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="w-16 h-12 rounded border-2 border-dashed border-primary/40 flex items-center justify-center">
              <Download className="h-6 w-6 text-primary/60" />
            </div>
            <div className="flex items-center gap-1 text-xs">
              <div className="px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">saturn-capture.zip</div>
            </div>
          </div>
        </div>
      );
    case 2:
      return (
        <div className={common} data-testid={`illustration-step-${step}`}>
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-10 h-10 rounded border bg-background flex items-center justify-center text-xs font-mono">.zip</div>
            <svg className="h-5 w-5 text-primary/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <FolderOpen className="h-4 w-4 text-primary/60" />
                <span className="text-xs font-mono">saturn-capture/</span>
              </div>
              <div className="ml-5 text-xs text-muted-foreground/60 space-y-0.5">
                <div>manifest.json</div>
                <div>background.js</div>
                <div>popup.html</div>
              </div>
            </div>
          </div>
        </div>
      );
    case 3:
      return (
        <div className={common} data-testid={`illustration-step-${step}`}>
          <div className="w-full max-w-xs">
            <div className="rounded-t border bg-background px-3 py-1.5 flex items-center gap-2">
              <Chrome className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="flex-1 rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">chrome://extensions</div>
            </div>
            <div className="rounded-b border border-t-0 bg-background/50 px-3 py-3 text-xs text-muted-foreground text-center">
              Extensions page
            </div>
          </div>
        </div>
      );
    case 4:
      return (
        <div className={common} data-testid={`illustration-step-${step}`}>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-medium">Developer mode</span>
            <div className="w-10 h-5 rounded-full bg-primary/70 relative">
              <div className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-card shadow-sm" />
            </div>
          </div>
        </div>
      );
    case 5:
      return (
        <div className={common} data-testid={`illustration-step-${step}`}>
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-2">
              <div className="px-3 py-1.5 rounded border bg-background text-xs font-medium shadow-sm flex items-center gap-1">
                <Puzzle className="h-3 w-3" />
                Load unpacked
              </div>
              <div className="px-3 py-1.5 rounded border bg-background text-xs text-muted-foreground">Pack extension</div>
            </div>
            <svg className="h-4 w-4 text-primary/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14m-7-7 7 7 7-7"/></svg>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FolderOpen className="h-3 w-3" />
              Select saturn-capture folder
            </div>
          </div>
        </div>
      );
    case 6:
      return (
        <div className={common} data-testid={`illustration-step-${step}`}>
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Globe className="h-4 w-4 text-primary/60" />
            </div>
            <div className="text-xs">
              <div className="font-medium text-foreground">Orbit</div>
              <div>Signed in as you@example.com</div>
            </div>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </div>
        </div>
      );
    default:
      return null;
  }
}

const steps = [
  {
    number: 1,
    title: "Download the Extension",
    description: 'Click the "Download Extension" button above to download the Saturn Capture extension as a .zip file.',
    icon: Download,
  },
  {
    number: 2,
    title: "Unzip the File",
    description: "Extract the downloaded saturn-capture.zip file to a folder on your computer. Remember where you save it — you'll need this location in step 5.",
    icon: FolderOpen,
  },
  {
    number: 3,
    title: "Open Chrome Extensions",
    description: "Open Google Chrome and navigate to chrome://extensions in the address bar. You can also get there from the Chrome menu → Extensions → Manage Extensions.",
    icon: Chrome,
  },
  {
    number: 4,
    title: "Enable Developer Mode",
    description: "In the top-right corner of the Extensions page, toggle the \"Developer mode\" switch to the ON position.",
    icon: ToggleRight,
  },
  {
    number: 5,
    title: 'Click "Load Unpacked"',
    description: 'Click the "Load unpacked" button that appears in the top-left after enabling Developer mode. Navigate to and select the unzipped saturn-capture folder.',
    icon: Puzzle,
  },
  {
    number: 6,
    title: "Sign Into Orbit",
    description: "Make sure you are signed into Orbit in the same browser profile where you installed the extension. The extension uses your existing session — no separate login or API key required.",
    icon: Globe,
  },
];

export default function BrowserExtensionPage() {
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await fetch("/api/extension/download");
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error || "Download failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "saturn-capture.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not download the extension. Please try again.";
      toast({ title: "Download failed", description: message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Browser Extension</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">
              Install the Saturn Capture extension to save web pages and images directly to your Content Library.
            </p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Puzzle className="h-3 w-3" />
            Chrome / Edge / Brave
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Download Extension
            </CardTitle>
            <CardDescription>
              Get the latest Saturn Capture extension package
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Button
                size="lg"
                onClick={handleDownload}
                disabled={downloading}
                data-testid="button-download-extension"
              >
                <Download className="h-4 w-4 mr-2" />
                {downloading ? "Downloading..." : "Download Extension (.zip)"}
              </Button>
              <span className="text-sm text-muted-foreground">
                Saturn Capture v1.0.0 — Manifest V3
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Installation Steps</CardTitle>
            <CardDescription>
              Follow these steps to install the extension in Chrome (also works in Edge, Brave, and other Chromium browsers)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.number} className="space-y-3" data-testid={`step-${step.number}`}>
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
                        {step.number}
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <h3 className="font-medium">{step.title}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {step.description}
                        </p>
                      </div>
                    </div>
                    <div className="ml-14">
                      <StepIllustration step={step.number} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                By default, the extension connects to the production Orbit URL (<code className="text-xs bg-muted px-1 py-0.5 rounded">https://app.synozur.com</code>).
                If you need to point it at a different server (e.g., a local development instance), you can change this in the extension settings.
              </AlertDescription>
            </Alert>
            <div className="text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">To change the Orbit URL:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Click the Saturn Capture extension icon in your browser toolbar</li>
                <li>Click <strong>Settings</strong></li>
                <li>Update the <strong>Orbit URL</strong> field to your desired server address</li>
                <li>Click <strong>Save</strong></li>
              </ol>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">Toolbar Capture</p>
                <p className="text-sm text-muted-foreground">
                  Click the extension icon to capture the full page you're viewing.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Right-Click Capture</p>
                <p className="text-sm text-muted-foreground">
                  Right-click on any image or page and select "Capture to Orbit" from the context menu.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Authentication</p>
                <p className="text-sm text-muted-foreground">
                  Uses your existing Orbit session — no API keys or separate login required.
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Destination</p>
                <p className="text-sm text-muted-foreground">
                  Captured items appear in your Content Library, scoped to your active tenant and market.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
