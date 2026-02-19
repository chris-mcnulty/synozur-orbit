import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUser } from "@/lib/userContext";
import { useQuery } from "@tanstack/react-query";
import { COMPANY_SIZES, JOB_ROLES, INDUSTRIES, COUNTRIES } from "@/lib/constants";
import { Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { SynozurAppSwitcher } from "@/components/SynozurAppSwitcher";

export default function AuthPage() {
  const [location, setLocation] = useLocation();
  const { login, register, user } = useUser();
  const [activeTab, setActiveTab] = useState<string>("signin");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [signinData, setSigninData] = useState({ email: "", password: "" });
  const [signupData, setSignupData] = useState({
    email: "",
    password: "",
    name: "",
    company: "",
    companySize: "",
    jobTitle: "",
    industry: "",
    country: "",
  });

  const { data: entraStatus } = useQuery({
    queryKey: ["/api/auth/entra/status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/entra/status");
      return res.json();
    },
  });

  useEffect(() => {
    if (location.includes("signup")) {
      setActiveTab("signup");
    } else {
      setActiveTab("signin");
    }
    
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) {
      setError(urlError === "sso_not_configured" ? "SSO is not configured" : 
               urlError === "token_acquisition_failed" ? "Authentication failed" : urlError);
    }
  }, [location]);

  useEffect(() => {
    if (user) {
      setLocation("/app");
    }
  }, [user, setLocation]);

  const handleSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(signinData.email, signinData.password);
      setLocation("/app");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const requiredFields = [
      { field: 'name', label: 'Full Name' },
      { field: 'email', label: 'Email' },
      { field: 'password', label: 'Password' },
      { field: 'company', label: 'Company' },
      { field: 'jobTitle', label: 'Job Title' },
      { field: 'industry', label: 'Industry' },
      { field: 'companySize', label: 'Company Size' },
      { field: 'country', label: 'Country' },
    ];

    for (const { field, label } of requiredFields) {
      if (!signupData[field as keyof typeof signupData]?.trim()) {
        setError(`Please fill in: ${label}`);
        return;
      }
    }

    setIsLoading(true);

    try {
      const avatar = signupData.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
      
      await register(
        signupData.email,
        signupData.password,
        signupData.name,
        signupData.company,
        avatar,
        signupData.companySize,
        signupData.jobTitle,
        signupData.industry,
        signupData.country
      );
      setLocation("/app");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const updateSignupField = (field: string, value: string) => {
    setSignupData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-6 relative"
      style={{
        backgroundImage: "url('/images/hero-background.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/40 via-background/90 to-secondary/40" />
      
      <div className="absolute top-4 left-4 z-20">
        <SynozurAppSwitcher currentApp="orbit" variant="dark" />
      </div>
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      
      <Card className="w-full max-w-md relative z-10 border-border/50 bg-background/95 backdrop-blur-sm shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/brand/synozur-horizontal.png" alt="Synozur" className="h-8 object-contain" />
            <span className="text-foreground/50 text-xl">|</span>
            <img src="/brand/orbit-logo.png" alt="Orbit" className="h-10 object-contain" />
          </div>
          <CardTitle className="text-xl">Welcome to Orbit</CardTitle>
          <CardDescription>Marketing intelligence, powered by AI</CardDescription>
        </CardHeader>
        
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="signin" data-testid="tab-signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup" data-testid="tab-signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-4">
              <form onSubmit={handleSignin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input 
                    id="signin-email" 
                    type="email" 
                    placeholder="name@example.com" 
                    required 
                    value={signinData.email}
                    onChange={(e) => setSigninData({ ...signinData, email: e.target.value })}
                    data-testid="input-signin-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input 
                    id="signin-password" 
                    type="password" 
                    required 
                    value={signinData.password}
                    onChange={(e) => setSigninData({ ...signinData, password: e.target.value })}
                    data-testid="input-signin-password"
                  />
                </div>
                
                {error && activeTab === "signin" && (
                  <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    {error}
                  </div>
                )}
                
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                  data-testid="button-signin"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>

              <div className="text-center">
                <a 
                  href="/auth/forgot-password" 
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </a>
              </div>

              {entraStatus?.configured && (
                <>
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full h-12" 
                    onClick={() => window.location.href = "/api/auth/entra"}
                    data-testid="button-signin-microsoft"
                  >
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                      <rect x="11" y="1" width="9" height="9" fill="#00a4ef"/>
                      <rect x="1" y="11" width="9" height="9" fill="#7fba00"/>
                      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                    </svg>
                    Continue with Microsoft
                  </Button>
                  
                  <div className="text-center space-y-1 mt-3">
                    <p className="text-xs text-muted-foreground">
                      Uses your existing Microsoft identity. No credit card required.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      No tenant changes or device management needed.
                    </p>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="signup" className="space-y-4">
              <form onSubmit={handleSignup} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="signup-name" className="text-xs">Full Name *</Label>
                    <Input 
                      id="signup-name" 
                      type="text" 
                      placeholder="John Doe" 
                      value={signupData.name}
                      onChange={(e) => updateSignupField('name', e.target.value)}
                      data-testid="input-signup-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="signup-company" className="text-xs">Company *</Label>
                    <Input 
                      id="signup-company" 
                      type="text" 
                      placeholder="Your company"
                      value={signupData.company}
                      onChange={(e) => updateSignupField('company', e.target.value)}
                      data-testid="input-signup-company"
                    />
                  </div>
                </div>
                
                <div className="space-y-1">
                  <Label htmlFor="signup-email" className="text-xs">Email *</Label>
                  <Input 
                    id="signup-email" 
                    type="email" 
                    placeholder="name@example.com" 
                    value={signupData.email}
                    onChange={(e) => updateSignupField('email', e.target.value)}
                    data-testid="input-signup-email"
                  />
                </div>
                
                <div className="space-y-1">
                  <Label htmlFor="signup-password" className="text-xs">Password *</Label>
                  <Input 
                    id="signup-password" 
                    type="password" 
                    value={signupData.password}
                    onChange={(e) => updateSignupField('password', e.target.value)}
                    minLength={6}
                    data-testid="input-signup-password"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Job Title *</Label>
                    <Select value={signupData.jobTitle} onValueChange={(v) => updateSignupField('jobTitle', v)}>
                      <SelectTrigger data-testid="select-signup-job">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>{role}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Industry *</Label>
                    <Select value={signupData.industry} onValueChange={(v) => updateSignupField('industry', v)}>
                      <SelectTrigger data-testid="select-signup-industry">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map((i) => (
                          <SelectItem key={i} value={i}>{i}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Company Size *</Label>
                    <Select value={signupData.companySize} onValueChange={(v) => updateSignupField('companySize', v)}>
                      <SelectTrigger data-testid="select-signup-size">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPANY_SIZES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Country *</Label>
                    <Select value={signupData.country} onValueChange={(v) => updateSignupField('country', v)}>
                      <SelectTrigger data-testid="select-signup-country">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {error && activeTab === "signup" && (
                  <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                    {error}
                  </div>
                )}
                
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                  data-testid="button-signup"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    "Create Account"
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  By signing up, you agree to our{" "}
                  <a href="https://www.synozur.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
                  {" "}and{" "}
                  <a href="https://www.synozur.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms</a>
                </p>
              </form>

              {entraStatus?.configured && (
                <>
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Or</span>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full h-12" 
                    onClick={() => window.location.href = "/api/auth/entra"}
                    data-testid="button-signup-microsoft"
                  >
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                      <rect x="11" y="1" width="9" height="9" fill="#00a4ef"/>
                      <rect x="1" y="11" width="9" height="9" fill="#7fba00"/>
                      <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                    </svg>
                    Continue with Microsoft
                  </Button>
                  
                  <div className="text-center space-y-1 mt-3">
                    <p className="text-xs text-muted-foreground">
                      Uses your existing Microsoft identity. No credit card required.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      No tenant changes or device management needed.
                    </p>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
          
          <div className="mt-6 text-center">
            <a 
              href="/" 
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
              data-testid="link-back-home"
            >
              ← Back to homepage
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
