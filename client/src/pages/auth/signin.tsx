import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "@/lib/userContext";
import { useQuery } from "@tanstack/react-query";

export default function SignIn() {
  const [, setLocation] = useLocation();
  const { login } = useUser();
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const { data: entraStatus } = useQuery({
    queryKey: ["/api/auth/entra/status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/entra/status");
      return res.json();
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) {
      setError(urlError === "sso_not_configured" ? "SSO is not configured" : 
               urlError === "token_acquisition_failed" ? "Authentication failed" : urlError);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(email, password);
      setLocation("/app");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-muted relative overflow-hidden">
         <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
         <div className="relative z-10">
           <h2 className="text-4xl font-bold mb-4">Welcome back to Orbit.</h2>
           <p className="text-xl text-muted-foreground max-w-md">
             Your command center for marketing intelligence.
           </p>
         </div>
      </div>
      
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-none shadow-none bg-transparent">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Sign in</CardTitle>
            <CardDescription>
              Enter your email to access your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="name@example.com" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="#" className="text-sm text-primary hover:underline">Forgot password?</Link>
                </div>
                <Input 
                  id="password" 
                  type="password" 
                  required 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}
              <Button 
                type="submit" 
                className="w-full bg-primary hover:bg-primary/90" 
                disabled={isLoading}
              >
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
            
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {entraStatus?.configured && (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => window.location.href = "/api/auth/entra"}
                  data-testid="signin-microsoft"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#00a4ef"/>
                    <rect x="1" y="11" width="9" height="9" fill="#7fba00"/>
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                  </svg>
                  Sign in with Microsoft
                </Button>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex justify-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link href="/auth/signup" className="text-primary hover:underline">Sign up</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
