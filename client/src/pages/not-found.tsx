import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, ArrowLeft, Search, Command } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function NotFound() {
  const [location] = useLocation();
  const isAppRoute = location.startsWith("/app");

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-lg mx-4 border-border">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="p-3 rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-2">Page Not Found</h1>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            The page you're looking for doesn't exist or may have been moved. 
            Try navigating back or use the options below.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
            {isAppRoute ? (
              <Link href="/app">
                <Button className="w-full sm:w-auto">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <Link href="/">
                <Button className="w-full sm:w-auto">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Home
                </Button>
              </Link>
            )}
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </Button>
          </div>

          {isAppRoute && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Search className="w-3 h-3" />
                Press
                <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  <Command className="w-2.5 h-2.5" />K
                </kbd>
                to search for pages and actions
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
