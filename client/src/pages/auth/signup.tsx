import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUser } from "@/lib/userContext";
import { COMPANY_SIZES, JOB_ROLES, INDUSTRIES, COUNTRIES } from "@/lib/constants";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePageTracking } from "@/hooks/use-page-tracking";

export default function SignUp() {
  usePageTracking("/auth/signup");
  const [, setLocation] = useLocation();
  const { register } = useUser();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    company: "",
    companySize: "",
    jobTitle: "",
    industry: "",
    country: "",
  });
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
      setError(urlError === "sso_not_configured" ? "SSO is not configured" : urlError);
    }
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
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
      if (!formData[field as keyof typeof formData]?.trim()) {
        setError(`Please fill in: ${label}`);
        return;
      }
    }

    setIsLoading(true);

    try {
      const avatar = formData.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
      
      await register(
        formData.email,
        formData.password,
        formData.name,
        formData.company,
        avatar,
        formData.companySize,
        formData.jobTitle,
        formData.industry,
        formData.country
      );
      setLocation("/app");
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-muted relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-secondary/20" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <img src="/brand/synozur-horizontal.png" alt="Synozur" className="h-10 object-contain" />
            <span className="text-foreground/50 text-2xl">|</span>
            <img src="/brand/orbit-logo.png" alt="Orbit" className="h-12 object-contain" />
          </div>
          <h2 className="text-4xl font-bold mb-4">Join Orbit today.</h2>
          <p className="text-xl text-muted-foreground max-w-md">
            Start tracking your competitors and winning with data-backed insights.
          </p>
        </div>
      </div>
      
      <div className="flex items-center justify-center p-6 overflow-y-auto">
        <Card className="w-full max-w-md border-none shadow-none bg-transparent">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Create an account</CardTitle>
            <CardDescription>
              Enter your details to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name <span className="text-destructive">*</span></Label>
                <Input 
                  id="name" 
                  type="text" 
                  placeholder="John Doe" 
                  value={formData.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  data-testid="input-name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="name@example.com" 
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  data-testid="input-email"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password <span className="text-destructive">*</span></Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={formData.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  minLength={6}
                  data-testid="input-password"
                />
                <p className="text-xs text-muted-foreground">At least 6 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="company">Company <span className="text-destructive">*</span></Label>
                <Input 
                  id="company" 
                  type="text" 
                  placeholder="Your company name"
                  value={formData.company}
                  onChange={(e) => updateField('company', e.target.value)}
                  data-testid="input-company"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job Title <span className="text-destructive">*</span></Label>
                <Select
                  value={formData.jobTitle}
                  onValueChange={(value) => updateField('jobTitle', value)}
                >
                  <SelectTrigger data-testid="select-job-title">
                    <SelectValue placeholder="Select job title" />
                  </SelectTrigger>
                  <SelectContent>
                    {JOB_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industry <span className="text-destructive">*</span></Label>
                <Select
                  value={formData.industry}
                  onValueChange={(value) => updateField('industry', value)}
                >
                  <SelectTrigger data-testid="select-industry">
                    <SelectValue placeholder="Select industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((industry) => (
                      <SelectItem key={industry} value={industry}>{industry}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="companySize">Company Size <span className="text-destructive">*</span></Label>
                <Select
                  value={formData.companySize}
                  onValueChange={(value) => updateField('companySize', value)}
                >
                  <SelectTrigger data-testid="select-company-size">
                    <SelectValue placeholder="Select company size" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_SIZES.map((size) => (
                      <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country <span className="text-destructive">*</span></Label>
                <Select
                  value={formData.country}
                  onValueChange={(value) => updateField('country', value)}
                >
                  <SelectTrigger data-testid="select-country">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>{country}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                data-testid="button-register"
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
                <a
                  href="https://www.synozur.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Privacy Policy
                </a>
                {" "}and{" "}
                <a
                  href="https://www.synozur.com/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Terms of Service
                </a>
              </p>
            </form>

            {entraStatus?.configured && (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>
                
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={() => window.location.href = "/api/auth/entra"}
                  data-testid="signup-microsoft"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#00a4ef"/>
                    <rect x="1" y="11" width="9" height="9" fill="#7fba00"/>
                    <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                  </svg>
                  Sign up with Microsoft
                </Button>
              </>
            )}
          </CardContent>
          <CardFooter className="flex justify-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/auth/signin" className="text-primary hover:underline">Sign in</Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
