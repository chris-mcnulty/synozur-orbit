import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink } from "lucide-react";

const SCOPE_DOCS = [
  { scope: "read:battlecards", desc: "Read battlecards visible to the user" },
  { scope: "read:briefings", desc: "Read intelligence briefings" },
  { scope: "read:personas", desc: "Read buyer personas" },
  { scope: "read:roadmap", desc: "Read product roadmap items" },
  { scope: "read:content-library", desc: "Read content library entries" },
  { scope: "read:brand-library", desc: "Read brand library assets" },
  { scope: "read:campaigns", desc: "Read marketing campaigns" },
  { scope: "read:reports", desc: "Read generated reports" },
  { scope: "read:posts", desc: "Read AI-generated social posts" },
];

const ENDPOINTS = [
  { path: "/api/v1/battlecards", scope: "read:battlecards" },
  { path: "/api/v1/briefings", scope: "read:briefings" },
  { path: "/api/v1/personas", scope: "read:personas" },
  { path: "/api/v1/roadmap", scope: "read:roadmap" },
  { path: "/api/v1/content-library", scope: "read:content-library" },
  { path: "/api/v1/brand-library", scope: "read:brand-library" },
  { path: "/api/v1/campaigns", scope: "read:campaigns" },
  { path: "/api/v1/reports", scope: "read:reports" },
  { path: "/api/v1/posts", scope: "read:posts" },
];

export default function DeveloperPortalPage() {
  const { toast } = useToast();
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6" data-testid="page-developer-portal">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Developer portal</h1>
        <p className="text-muted-foreground">
          Build third-party integrations on top of Orbit using our OAuth 2.0 + PKCE Partner API.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authorization Code + PKCE flow</CardTitle>
          <CardDescription>Use the standard Authorization Code grant with PKCE (S256). Public clients (SPAs) do not require a secret.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="font-medium mb-1">1. Redirect users to the authorize endpoint</div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto" data-testid="text-authorize-url">
{`GET ${origin}/oauth/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_CALLBACK
  &scope=read:battlecards read:reports
  &state=RANDOM_STATE
  &code_challenge=BASE64URL(SHA256(verifier))
  &code_challenge_method=S256`}
            </pre>
          </div>
          <div>
            <div className="font-medium mb-1">2. Exchange the code for tokens</div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`POST ${origin}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=CODE_FROM_REDIRECT
&redirect_uri=YOUR_CALLBACK
&client_id=YOUR_CLIENT_ID
&code_verifier=ORIGINAL_VERIFIER`}
            </pre>
          </div>
          <div>
            <div className="font-medium mb-1">3. Call the API</div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`curl ${origin}/api/v1/battlecards \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"`}
            </pre>
          </div>
          <div>
            <div className="font-medium mb-1">4. Refresh tokens</div>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
{`POST ${origin}/oauth/token
grant_type=refresh_token&refresh_token=...&client_id=...`}
            </pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available scopes</CardTitle>
          <CardDescription>Request only the scopes your integration needs.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {SCOPE_DOCS.map((s) => (
              <li key={s.scope} className="flex items-start gap-2" data-testid={`row-scope-${s.scope}`}>
                <code className="bg-muted px-1.5 rounded text-xs">{s.scope}</code>
                <span className="text-muted-foreground">— {s.desc}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>All endpoints are read-only in v1 and return JSON.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Method</th>
                <th className="py-2">Path</th>
                <th className="py-2">Required scope</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-b" data-testid={`row-endpoint-${e.path}`}>
                  <td className="py-2"><Badge variant="outline">GET</Badge></td>
                  <td className="py-2 font-mono">{e.path}</td>
                  <td className="py-2"><code className="text-xs">{e.scope}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenAPI specification</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <code className="bg-muted px-2 py-1 rounded text-xs flex-1">{origin}/api/v1/openapi.json</code>
          <Button size="sm" variant="outline" onClick={() => copy(`${origin}/api/v1/openapi.json`)} data-testid="button-copy-openapi"><Copy className="w-3 h-3 mr-1" />Copy</Button>
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" data-testid="link-open-openapi"><ExternalLink className="w-3 h-3 mr-1" />Open</Button>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate limits & best practices</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>• Tokens are limited to 120 requests per minute per token (sliding window).</p>
          <p>• Access tokens expire after 1 hour; refresh tokens after 30 days.</p>
          <p>• Refresh tokens are rotated — replace your stored refresh token with the new one each time.</p>
          <p>• All access is read-only in v1 and is scoped to the user that authorized the app.</p>
        </CardContent>
      </Card>
    </div>
  );
}
