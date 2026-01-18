import React from "react";
import PublicLayout from "@/components/layout/PublicLayout";
import { FileText, Map, ListTodo } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import MarkdownViewer from "@/components/MarkdownViewer";

export default function About() {
  return (
    <PublicLayout>
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">
              About <span className="text-primary">Orbit</span>
            </h1>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              AI-powered competitive intelligence platform from The Synozur Alliance.
            </p>
          </div>

          <Tabs defaultValue="changelog" className="w-full">
            <Card className="border-border">
              <CardHeader className="border-b border-border pb-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="changelog" className="flex items-center gap-2" data-testid="tab-changelog">
                    <FileText size={16} />
                    Changelog
                  </TabsTrigger>
                  <TabsTrigger value="backlog" className="flex items-center gap-2" data-testid="tab-backlog">
                    <ListTodo size={16} />
                    Backlog
                  </TabsTrigger>
                  <TabsTrigger value="roadmap" className="flex items-center gap-2" data-testid="tab-roadmap">
                    <Map size={16} />
                    Roadmap
                  </TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="pt-6">
                <TabsContent value="changelog" className="mt-0">
                  <div className="mb-4">
                    <p className="text-sm text-muted-foreground">
                      A detailed history of all updates, improvements, and new features.
                    </p>
                  </div>
                  <MarkdownViewer url="/api/content/changelog.md" maxHeight="500px" />
                </TabsContent>
                <TabsContent value="backlog" className="mt-0">
                  <div className="mb-4">
                    <p className="text-sm text-muted-foreground">
                      Features and improvements we're tracking for future releases.
                    </p>
                  </div>
                  <MarkdownViewer url="/api/content/backlog.md" maxHeight="500px" />
                </TabsContent>
                <TabsContent value="roadmap" className="mt-0">
                  <div className="mb-4">
                    <p className="text-sm text-muted-foreground">
                      Our product vision and planned milestones.
                    </p>
                  </div>
                  <div className="text-center py-12 text-muted-foreground">
                    <Map className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Detailed roadmap coming soon.</p>
                    <p className="text-xs mt-2">Check the backlog tab for upcoming features.</p>
                  </div>
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        </div>
      </section>
    </PublicLayout>
  );
}
