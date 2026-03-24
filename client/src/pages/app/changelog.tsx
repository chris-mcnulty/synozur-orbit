import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import AppLayout from "@/components/layout/AppLayout";
import MarkdownViewer from "@/components/MarkdownViewer";

export default function AppChangelogPage() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileText className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Changelog</h1>
            <p className="text-muted-foreground text-sm">A history of updates, improvements, and new features</p>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText size={18} className="text-primary" />
              Release History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="p-6">
                <MarkdownViewer url="/api/content/changelog.md" maxHeight="none" />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
