import React from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Shield, User, Crown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/lib/userContext";

export default function UsersPage() {
  const { user: currentUser } = useUser();

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch("/api/users", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("You don't have permission to view users");
        }
        throw new Error("Failed to fetch users");
      }
      return response.json();
    },
  });

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "Global Admin":
        return <Crown size={14} className="text-yellow-500" />;
      case "Domain Admin":
        return <Shield size={14} className="text-primary" />;
      default:
        return <User size={14} className="text-muted-foreground" />;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "Global Admin":
        return "default";
      case "Domain Admin":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <p className="text-destructive mb-2">{(error as Error).message}</p>
          <p className="text-muted-foreground text-sm">Only admins can access user management.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex justify-between items-center">
        <div>
           <h1 className="text-3xl font-bold tracking-tight mb-2">User Management</h1>
           <p className="text-muted-foreground">Manage access and roles for your workspace.</p>
        </div>
        <Button>
            <Plus className="w-4 h-4 mr-2" /> Invite User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? 's' : ''} in your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No users found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user: any) => (
                  <TableRow key={user.id} className={user.id === currentUser?.id ? "bg-primary/5" : ""}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {user.avatar || user.name?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-semibold flex items-center gap-2">
                            {user.name}
                            {user.id === currentUser?.id && (
                              <Badge variant="outline" className="text-xs">You</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getRoleIcon(user.role)}
                        <Badge variant={getRoleBadgeVariant(user.role)}>
                          {user.role}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.company || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Edit Role</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">Remove User</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
