import { ApiHttpError, ApiResponseError, type createApiClient } from "./client";

export interface PublicAddress {
  id: string;
  label: string;
  recipientName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  deliveryInstructions?: string;
}

export type UserRole = "customer" | "admin";

export interface PublicUser {
  id: string;
  email: string;
  displayName?: string;
  phoneNumber?: string;
  emailVerified: boolean;
  roles: UserRole[];
  addresses: PublicAddress[];
  createdAt: string;
  updatedAt: string;
}

export type LoginResponse =
  { user: PublicUser } | { twoFactorRequired: true } | { twoFactorEnrollmentRequired: true };

export type SessionState =
  { status: "unauthenticated" } | { status: "authenticated"; user: PublicUser };

export type AuthApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

export function createAuthApi(client: AuthApiClient) {
  return {
    async getSession(): Promise<SessionState> {
      try {
        const response = await client.request<{ user: PublicUser }>("/auth/me");
        if (!response || !response.user) {
          throw new ApiResponseError(200, "Backend returned no current user.");
        }
        return { status: "authenticated", user: response.user };
      } catch (error) {
        if (error instanceof ApiHttpError && error.status === 401) {
          return { status: "unauthenticated" };
        }
        throw error;
      }
    },

    login(credentials: { email: string; password: string }) {
      return client.request<LoginResponse>("/auth/login", {
        method: "POST",
        json: credentials,
        regeneratesSession: true,
      });
    },

    logout() {
      return client.request<void>("/auth/logout", {
        method: "POST",
        regeneratesSession: true,
      });
    },

    verifyTwoFactor(code: string) {
      return client.request<{ user: PublicUser }>("/auth/2fa/verify", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
    },

    confirmTwoFactor(code: string) {
      return client.request<{
        twoFactorEnabled: true;
        recoveryCodes: string[];
      }>("/auth/2fa/confirm", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
    },
  };
}
