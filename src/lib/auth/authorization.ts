import type { PublicUser } from "@/lib/api/auth";

export function isAdminUser(user: PublicUser): boolean {
  return (
    user.emailVerified &&
    user.roles.includes("admin") &&
    user.email.trim().toLowerCase().endsWith("@healtywayssa.co.za")
  );
}
