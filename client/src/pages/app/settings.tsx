import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Check } from "lucide-react";

export default function Settings() {
  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">Manage your workspace, billing, and integrations.</p>
      </div>

      <div className="space-y-8">
        {/* Workspace Profile */}
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
                <div className="grid gap-2">
                    <Label>Subdomain</Label>
                    <div className="flex items-center gap-2">
                       <Input defaultValue="acme" className="flex-1" />
                       <span className="text-muted-foreground text-sm font-medium">.orbit.synozur.com</span>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="border-t border-border px-6 py-4">
                <Button>Save Changes</Button>
            </CardFooter>
        </Card>

        {/* Plan & Billing */}
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>Plan & Billing</CardTitle>
                        <CardDescription>Manage your subscription and payment methods.</CardDescription>
                    </div>
                    <Badge variant="secondary" className="text-primary bg-primary/10 border-primary/20">Free Plan</Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="bg-muted/30 p-4 rounded-lg border border-border flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div>
                            <p className="font-medium">No payment method added</p>
                            <p className="text-sm text-muted-foreground">Upgrade to unlock full features.</p>
                        </div>
                    </div>
                    <Button variant="outline" size="sm">Add Card</Button>
                </div>

                <div className="space-y-2">
                     <p className="text-sm font-medium">Plan Usage</p>
                     <div className="grid grid-cols-2 gap-4">
                         <div className="p-4 border border-border rounded-lg">
                             <div className="text-sm text-muted-foreground mb-1">Competitors</div>
                             <div className="text-2xl font-bold">3 <span className="text-muted-foreground text-sm font-normal">/ 5</span></div>
                         </div>
                         <div className="p-4 border border-border rounded-lg">
                             <div className="text-sm text-muted-foreground mb-1">Analysis Runs</div>
                             <div className="text-2xl font-bold">12 <span className="text-muted-foreground text-sm font-normal">/ 50</span></div>
                         </div>
                     </div>
                </div>
            </CardContent>
             <CardFooter className="border-t border-border px-6 py-4 bg-muted/20">
                <Button variant="default" className="w-full sm:w-auto">Upgrade to Pro</Button>
            </CardFooter>
        </Card>

        {/* Integrations */}
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
                
                <Separator />
                
                <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                        <Label className="text-base">Microsoft Entra ID (SSO)</Label>
                        <p className="text-sm text-muted-foreground">Enterprise Single Sign-On.</p>
                    </div>
                    <Button variant="outline" size="sm">Configure</Button>
                </div>
                
                <Separator />
                
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
