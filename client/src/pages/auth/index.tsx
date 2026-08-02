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
  const { login, register, refetch, user } = useUser();
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

  const { data: googleStatus } = useQuery({
    queryKey: ["/api/auth/google/status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/google/status");
      return res.json();
    },
  });

  const { data: publicConfig } = useQuery<{ recaptchaSiteKey: string; recaptchaEnabled: boolean }>({
    queryKey: ["/api/auth/public-config"],
    queryFn: async () => {
      const res = await fetch("/api/auth/public-config");
      return res.json();
    },
  });

  const recaptchaSiteKey = publicConfig?.recaptchaSiteKey || "";
  const recaptchaEnabled = !!publicConfig?.recaptchaEnabled;
  const [recaptchaV3Ready, setRecaptchaV3Ready] = useState(false);
  const [needsV2Challenge, setNeedsV2Challenge] = useState(false);
  const v2WidgetIdRef = React.useRef<number | null>(null);
  const v2ContainerRef = React.useRef<HTMLDivElement | null>(null);

  // Inject reCAPTCHA v3 + v2 scripts once we know the site key
  useEffect(() => {
    if (!recaptchaEnabled || !recaptchaSiteKey) return;
    if (document.querySelector("script[data-recaptcha-v3]")) {
      setRecaptchaV3Ready(true);
      return;
    }
    const s = document.createElement("script");
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(recaptchaSiteKey)}`;
    s.async = true;
    s.defer = true;
    s.setAttribute("data-recaptcha-v3", "true");
    s.onload = () => setRecaptchaV3Ready(true);
    document.head.appendChild(s);

    if (!document.querySelector("script[data-recaptcha-v2]")) {
      const s2 = document.createElement("script");
      s2.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      s2.async = true;
      s2.defer = true;
      s2.setAttribute("data-recaptcha-v2", "true");
      document.head.appendChild(s2);
    }
  }, [recaptchaEnabled, recaptchaSiteKey]);

  // Render the v2 challenge when the server tells us the v3 score was too low
  useEffect(() => {
    if (!needsV2Challenge || !recaptchaSiteKey) return;
    const grecaptcha = (window as any).grecaptcha;
    if (!grecaptcha || !grecaptcha.render || !v2ContainerRef.current) return;
    if (v2WidgetIdRef.current !== null) return;
    try {
      v2WidgetIdRef.current = grecaptcha.render(v2ContainerRef.current, {
        sitekey: recaptchaSiteKey,
      });
    } catch (e) {
      console.error("[reCAPTCHA] v2 render failed", e);
    }
  }, [needsV2Challenge, recaptchaSiteKey]);

  const getRecaptchaTokens = async (): Promise<{ recaptchaToken?: string; recaptchaV2Token?: string }> => {
    if (!recaptchaEnabled || !recaptchaSiteKey) return {};
    const grecaptcha = (window as any).grecaptcha;
    if (needsV2Challenge && v2WidgetIdRef.current !== null && grecaptcha?.getResponse) {
      const v2 = grecaptcha.getResponse(v2WidgetIdRef.current);
      if (!v2) {
        throw new Error("Please complete the reCAPTCHA challenge.");
      }
      return { recaptchaV2Token: v2 };
    }
    if (recaptchaV3Ready && grecaptcha?.execute) {
      try {
        const token: string = await new Promise((resolve, reject) => {
          grecaptcha.ready(async () => {
            try {
              const t = await grecaptcha.execute(recaptchaSiteKey, { action: "signup" });
              resolve(t);
            } catch (err) {
              reject(err);
            }
          });
        });
        return { recaptchaToken: token };
      } catch (e) {
        console.error("[reCAPTCHA] v3 execute failed", e);
      }
    }
    return {};
  };

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

  // Resolve where to send the user after a successful sign-in. If the URL
  // carries `?next=/...` (e.g. the OAuth `/oauth/authorize` flow that bounced
  // an unauthenticated user here), honor that — but only if it is a safe
  // same-origin path. Otherwise fall back to the last-visited app page,
  // and finally to `/app`.
  const resolvePostLoginTarget = (): string => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return next;
    }
    const lastPage = localStorage.getItem("observatory_last_page");
    return lastPage && lastPage.startsWith("/app") ? lastPage : "/app";
  };

  /**
   * Navigate to a post-login target. SPA routes (`/app/...`) use Wouter so
   * we keep the React tree mounted; non-SPA targets like
   * `/oauth/authorize?...` are server-rendered routes, so we MUST do a full
   * document navigation, otherwise Wouter would render the SPA 404 instead
   * of bouncing the user back to the consent screen.
   */
  const navigateAfterLogin = (target: string) => {
    if (target.startsWith("/app")) {
      setLocation(target);
    } else {
      window.location.assign(target);
    }
  };

  // UX1: Redirect to next (if pending OAuth) or last-visited page
  useEffect(() => {
    if (user) {
      navigateAfterLogin(resolvePostLoginTarget());
    }
  }, [user, setLocation]);

  const handleSignin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(signinData.email, signinData.password);
      navigateAfterLogin(resolvePostLoginTarget());
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
      const tokens = await getRecaptchaTokens();
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: signupData.email,
          password: signupData.password,
          name: signupData.name,
          company: signupData.company,
          avatar,
          companySize: signupData.companySize,
          jobTitle: signupData.jobTitle,
          industry: signupData.industry,
          country: signupData.country,
          ...tokens,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (err?.requiresChallenge) {
          setNeedsV2Challenge(true);
        }
        throw new Error(err?.error || "Registration failed");
      }
      await refetch();
      setLocation("/app");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const startGoogleSignIn = () => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
    window.location.href = safeNext
      ? `/api/auth/google?next=${encodeURIComponent(safeNext)}`
      : "/api/auth/google";
  };

  const GoogleIcon = () => (
    <svg className="w-5 h-5 mr-2" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.4 4.5 9.8 8.8 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 43.5c5.1 0 9.7-1.9 13.2-5.1l-6.1-5c-2 1.5-4.5 2.4-7.1 2.4-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.7 39.1 16.3 43.5 24 43.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.1 5c-.4.4 6.6-4.8 6.6-14.4 0-1.2-.1-2.4-.4-3.5z"/>
    </svg>
  );

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
        <SynozurAppSwitcher currentApp="observatory" forceDark />
      </div>
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      
      <Card className="w-full max-w-md relative z-10 border-border/50 bg-background/95 backdrop-blur-sm shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/brand/synozur-horizontal.png" alt="Synozur" className="h-8 object-contain" />
            <span className="text-foreground/50 text-xl">|</span>
            <span className="font-bold text-xl tracking-tight">Observatory</span>
          </div>
          <CardTitle className="text-xl">Welcome to Observatory</CardTitle>
          <CardDescription>Application assurance &amp; certification intelligence</CardDescription>
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
                    onClick={() => {
                      const params = new URLSearchParams(window.location.search);
                      const next = params.get("next");
                      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
                      window.location.href = safeNext
                        ? `/api/auth/entra?next=${encodeURIComponent(safeNext)}`
                        : "/api/auth/entra";
                    }}
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

              {googleStatus?.configured && (
                <>
                  {!entraStatus?.configured && (
                    <div className="relative my-4">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">Or</span>
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="w-full h-12 mt-2"
                    onClick={startGoogleSignIn}
                    data-testid="button-signin-google"
                  >
                    <GoogleIcon />
                    Continue with Google
                  </Button>
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

                {needsV2Challenge && (
                  <div className="flex justify-center my-2">
                    <div ref={v2ContainerRef} data-testid="recaptcha-v2-container" />
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
                    onClick={() => {
                      const params = new URLSearchParams(window.location.search);
                      const next = params.get("next");
                      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
                      window.location.href = safeNext
                        ? `/api/auth/entra?next=${encodeURIComponent(safeNext)}`
                        : "/api/auth/entra";
                    }}
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

              {googleStatus?.configured && (
                <>
                  {!entraStatus?.configured && (
                    <div className="relative my-2">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">Or</span>
                      </div>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="w-full h-12 mt-2"
                    onClick={startGoogleSignIn}
                    data-testid="button-signup-google"
                  >
                    <GoogleIcon />
                    Continue with Google
                  </Button>
                </>
              )}

              {recaptchaEnabled && (
                <p className="text-[10px] text-center text-muted-foreground mt-2">
                  Protected by reCAPTCHA — Google{" "}
                  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy</a>
                  {" "}&{" "}
                  <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms</a>.
                </p>
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
