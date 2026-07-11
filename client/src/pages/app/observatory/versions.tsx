import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { GitBranch, Loader2 } from "lucide-react";
import { VersionStatusBadge } from "./shared";
import { formatDate } from "@/lib/utils";

interface VersionRow {
  id: string;
  applicationId: string;
  applicationName: string;
  versionNumber: string;
  environment: string | null;
  assessmentStatus: string;
  releaseDate: string | null;
  branch: string | null;
  notes: string | null;
}

export default function ObservatoryVersions() {
  const { data: versions, isLoading } = useQuery<VersionRow[]>({ queryKey: ["/api/observatory/versions"] });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-versions-title">Versions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every tracked release across the portfolio, with assessment readiness. Versions are created from an application's detail page.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (versions ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-3">
              <GitBranch className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No versions tracked yet</p>
              <p className="text-sm text-muted-foreground">Open an application and add its first version.</p>
              <Link href="/app/observatory/applications">
                <Button variant="outline" data-testid="link-go-applications">Go to Applications</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {(versions ?? []).map((v) => (
              <Link key={v.id} href={`/app/observatory/applications/${v.applicationId}`}>
                <Card className="cursor-pointer hover:border-primary/50 transition-colors" data-testid={`card-version-${v.id}`}>
                  <CardContent className="py-3 px-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">
                        <span className="text-muted-foreground">{v.applicationName}</span> · v{v.versionNumber}
                        {v.environment ? <span className="text-muted-foreground"> · {v.environment}</span> : null}
                      </p>
                      {(v.branch || v.notes) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {[v.branch, v.notes].filter(Boolean).join(" — ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {v.releaseDate && <span className="text-xs text-muted-foreground">{formatDate(v.releaseDate)}</span>}
                      <VersionStatusBadge status={v.assessmentStatus} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
