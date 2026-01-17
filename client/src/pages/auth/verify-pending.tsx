import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { MailCheck, RefreshCw, ArrowLeft } from "lucide-react";

export default function VerifyPending() {
  const [, setLocation] = useLocation();
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState("");

  const searchParams = new URLSearchParams(window.location.search);
  const email = searchParams.get("email") || "";

  const handleResend = async () => {
    if (!email) return;
    
    setIsResending(true);
    setError("");
    setResendSuccess(false);

    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to resend verification email");
      }

      setResendSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-muted relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
        <div className="relative z-10">
          <h2 className="text-4xl font-bold mb-4">Almost there!</h2>
          <p className="text-xl text-muted-foreground max-w-md">
            One more step to unlock your competitive intelligence.
          </p>
        </div>
      </div>
      
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-none shadow-none bg-transparent">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <MailCheck className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">Check your email</CardTitle>
            <CardDescription className="text-base">
              We've sent a verification link to
            </CardDescription>
            {email && (
              <p className="font-semibold text-foreground">{email}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-2">
              <p>Click the link in the email to verify your address and complete your registration.</p>
              <p>Once verified, you'll be set up as the administrator for your organization.</p>
            </div>
            
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md" data-testid="error-message">
                {error}
              </div>
            )}
            
            {resendSuccess && (
              <div className="text-sm text-green-600 bg-green-500/10 p-3 rounded-md" data-testid="success-message">
                Verification email sent! Please check your inbox.
              </div>
            )}
            
            <div className="text-center text-sm text-muted-foreground">
              <p>Didn't receive the email?</p>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleResend}
                disabled={isResending || !email}
                className="mt-2"
                data-testid="button-resend"
              >
                {isResending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Resend verification email
                  </>
                )}
              </Button>
            </div>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button 
              variant="ghost"
              onClick={() => setLocation("/auth/signin")}
              data-testid="button-back-signin"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to sign in
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
