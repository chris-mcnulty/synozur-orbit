import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export default function Settings() {
  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your workspace and integrations.</p>
      </div>

      <div className="space-y-8">
        <Card>
            <CardHeader>
                <CardTitle>Workspace Profile</CardTitle>
                <CardDescription>General settings for your tenant.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-2">
                    <Label>Workspace Name</Label>
                    <Input defaultValue="Acme Corp" />
                </div>
            </CardContent>
        </Card>

        <Card>
            <CardHeader>
                <CardTitle>Integrations</CardTitle>
                <CardDescription>Connect Orbit to your existing stack.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">Google OAuth</Label>
                        <p className="text-sm text-muted-foreground">Allow users to sign in with Google Workspace.</p>
                    </div>
                    <Switch defaultChecked />
                </div>
                
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">Microsoft Entra ID (SSO)</Label>
                        <p className="text-sm text-muted-foreground">Enterprise Single Sign-On.</p>
                    </div>
                    <Button variant="outline" size="sm">Configure</Button>
                </div>
                
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">HubSpot</Label>
                        <p className="text-sm text-muted-foreground">Sync reports to your CRM.</p>
                    </div>
                    <Button variant="outline" size="sm">Connect</Button>
                </div>
            </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
