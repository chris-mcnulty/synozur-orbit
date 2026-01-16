import React, { createContext, useContext, useState, useEffect } from "react";

type UserRole = "Global Admin" | "Domain Admin" | "Standard User";

interface User {
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  company: string;
}

interface UserContextType {
  user: User | null;
  login: (email: string, password?: string) => void;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  // Load user from local storage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem("orbit_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = (email: string) => {
    const domain = email.split("@")[1];
    const companyName = domain.split(".")[0];
    const name = email.split("@")[0].split(".").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    const initials = name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

    let role: UserRole = "Standard User";

    // Mock Logic for Roles
    const globalAdminExists = localStorage.getItem("orbit_global_admin_exists");
    const knownDomains = JSON.parse(localStorage.getItem("orbit_known_domains") || "[]");

    if (!globalAdminExists) {
      // First user ever is Global Admin
      role = "Global Admin";
      localStorage.setItem("orbit_global_admin_exists", "true");
    } else if (!knownDomains.includes(domain)) {
      // First user for this domain is Domain Admin
      role = "Domain Admin";
      knownDomains.push(domain);
      localStorage.setItem("orbit_known_domains", JSON.stringify(knownDomains));
    }

    const newUser: User = {
      name: name,
      email: email,
      role: role,
      avatar: initials,
      company: companyName.charAt(0).toUpperCase() + companyName.slice(1)
    };

    setUser(newUser);
    localStorage.setItem("orbit_user", JSON.stringify(newUser));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("orbit_user");
  };

  return (
    <UserContext.Provider value={{ user, login, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
