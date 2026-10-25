import { AdminManagement } from "@/components/storefront/admin-management";
import type { PublicUser } from "@/lib/api/auth";
import { isAdminUser } from "@/lib/auth/authorization";

export function AdminPanel({ user }: { user: PublicUser | null }) {
  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <header className="admin-panel-header">
        <div>
          <span className="eyebrow">Healthy Ways SA</span>
          <h2 id="admin-title" className="section-title mt-3">
            Administrator workspace
          </h2>
        </div>
      </header>
      {!user ? (
        <div className="admin-card" role="alert">
          <h3>Administrator access denied</h3>
          <p>
            Sign in with an authorized administrator account. The backend role, verified email,
            administrator domain and completed two-factor session are all required.
          </p>
        </div>
      ) : isAdminUser(user) ? (
        <AdminManagement />
      ) : (
        <div className="admin-card" role="alert">
          <h3>Administrator access denied</h3>
          <p>
            Access requires a verified account with the backend administrator role and an
            {` @healtywayssa.co.za `}email address. A matching email alone does not grant access.
          </p>
        </div>
      )}
    </section>
  );
}
