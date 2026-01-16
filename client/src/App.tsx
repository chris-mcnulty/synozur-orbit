import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Landing from "@/pages/landing";
import SignIn from "@/pages/auth/signin";
import Dashboard from "@/pages/app/dashboard";
import Analysis from "@/pages/app/analysis";
import Recommendations from "@/pages/app/recommendations";
import Activity from "@/pages/app/activity";
import Reports from "@/pages/app/reports";
import Competitors from "@/pages/app/competitors";
import CompetitorDetail from "@/pages/app/competitor-detail";
import Settings from "@/pages/app/settings";
import UsersPage from "@/pages/app/users";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/pricing" component={Landing} /> {/* Placeholder */}
      <Route path="/auth/signin" component={SignIn} />
      <Route path="/auth/signup" component={SignIn} /> {/* Reuse for prototype */}
      
      {/* App Routes */}
      <Route path="/app" component={Dashboard} />
      <Route path="/app/dashboard" component={Dashboard} />
      <Route path="/app/competitors" component={Competitors} />
      <Route path="/app/competitors/:id" component={CompetitorDetail} />
      <Route path="/app/analysis" component={Analysis} />
      <Route path="/app/recommendations" component={Recommendations} />
      <Route path="/app/activity" component={Activity} />
      <Route path="/app/reports" component={Reports} />
      <Route path="/app/settings" component={Settings} />
      <Route path="/app/users" component={UsersPage} />
      <Route path="/app/usage" component={Settings} /> {/* Reuse Settings as placeholder */}
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
