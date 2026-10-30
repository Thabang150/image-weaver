import {
  ApiHttpError,
  ApiResponseError,
  createConfiguredApiClient,
  type createApiClient,
} from "./client";

export interface PublicAddress {
  id: string;
  isDefault?: boolean;
  label: string;
  recipientName: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2?: string;
  localArea?: string;
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
  | { user: PublicUser }
  | { twoFactorRequired: true }
  | { twoFactorEnrollmentRequired: true }
  | { emailOtpRequired: true };

export interface RegistrationResult {
  user: PublicUser;
  emailVerificationEmailSent: boolean;
}

export type SessionState =
  { status: "unauthenticated" } | { status: "authenticated"; user: PublicUser };

export type AuthApiClient = Pick<ReturnType<typeof createApiClient>, "request">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicAddress(value: unknown): value is PublicAddress {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    (value["isDefault"] === undefined || typeof value["isDefault"] === "boolean") &&
    typeof value["label"] === "string" &&
    typeof value["recipientName"] === "string" &&
    typeof value["phoneNumber"] === "string" &&
    typeof value["addressLine1"] === "string" &&
    (value["addressLine2"] === undefined || typeof value["addressLine2"] === "string") &&
    (value["localArea"] === undefined || typeof value["localArea"] === "string") &&
    typeof value["city"] === "string" &&
    typeof value["province"] === "string" &&
    typeof value["postalCode"] === "string" &&
    typeof value["country"] === "string" &&
    (value["deliveryInstructions"] === undefined ||
      typeof value["deliveryInstructions"] === "string")
  );
}

function isPublicUser(value: unknown): value is PublicUser {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["email"] === "string" &&
    (value["displayName"] === undefined || typeof value["displayName"] === "string") &&
    (value["phoneNumber"] === undefined || typeof value["phoneNumber"] === "string") &&
    typeof value["emailVerified"] === "boolean" &&
    Array.isArray(value["roles"]) &&
    value["roles"].every((role) => role === "customer" || role === "admin") &&
    Array.isArray(value["addresses"]) &&
    value["addresses"].every(isPublicAddress) &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string"
  );
}

function invalidAuthResponse(): never {
  throw new ApiResponseError(200, "Backend returned an invalid authentication response.");
}

export function createAuthApi(client: AuthApiClient) {
  return {
    async getSession(): Promise<SessionState> {
      try {
        const response = await client.request<unknown>("/auth/me");
        if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
        return { status: "authenticated", user: response["user"] };
      } catch (error) {
        if (error instanceof ApiHttpError && error.status === 401) {
          return { status: "unauthenticated" };
        }
        throw error;
      }
    },

    async login(credentials: { email: string; password: string }): Promise<LoginResponse> {
      const response = await client.request<unknown>("/auth/login", {
        method: "POST",
        json: credentials,
        regeneratesSession: true,
      });
      if (
        isRecord(response) &&
        response["twoFactorRequired"] === true &&
        Object.keys(response).length === 1
      ) {
        return { twoFactorRequired: true };
      }
      if (
        isRecord(response) &&
        response["twoFactorEnrollmentRequired"] === true &&
        Object.keys(response).length === 1
      ) {
        return { twoFactorEnrollmentRequired: true };
      }
      if (
        isRecord(response) &&
        response["emailOtpRequired"] === true &&
        Object.keys(response).length === 1
      ) {
        return { emailOtpRequired: true };
      }
      if (isRecord(response) && isPublicUser(response["user"])) {
        return { user: response["user"] };
      }
      return invalidAuthResponse();
    },

    async register(input: {
      email: string;
      password: string;
      displayName?: string;
      phoneNumber?: string;
    }): Promise<RegistrationResult> {
      const response = await client.request<unknown>("/auth/register", {
        method: "POST",
        json: input,
      });
      if (
        !isRecord(response) ||
        !isPublicUser(response["user"]) ||
        typeof response["emailVerificationEmailSent"] !== "boolean"
      ) {
        return invalidAuthResponse();
      }
      return {
        user: response["user"],
        emailVerificationEmailSent: response["emailVerificationEmailSent"],
      };
    },

    async requestVerification(email: string): Promise<{ message: string }> {
      const response = await client.request<unknown>("/auth/request-verification", {
        method: "POST",
        json: { email },
      });
      if (!isRecord(response) || typeof response["message"] !== "string") {
        return invalidAuthResponse();
      }
      return { message: response["message"] };
    },

    async verifyEmail(token: string): Promise<{ message: string }> {
      const response = await client.request<unknown>("/auth/verify-email", {
        method: "POST",
        json: { token },
      });
      if (!isRecord(response) || typeof response["message"] !== "string") {
        return invalidAuthResponse();
      }
      return { message: response["message"] };
    },

    async forgotPassword(email: string): Promise<{ message: string }> {
      const response = await client.request<unknown>("/auth/forgot-password", {
        method: "POST",
        json: { email },
      });
      if (!isRecord(response) || typeof response["message"] !== "string") {
        return invalidAuthResponse();
      }
      return { message: response["message"] };
    },

    async resetPassword(token: string, password: string): Promise<{ message: string }> {
      const response = await client.request<unknown>("/auth/reset-password", {
        method: "POST",
        json: { token, password },
      });
      if (!isRecord(response) || typeof response["message"] !== "string") {
        return invalidAuthResponse();
      }
      return { message: response["message"] };
    },

    async updateProfile(input: { displayName?: string; phoneNumber?: string }) {
      const response = await client.request<unknown>("/users/me", {
        method: "PATCH",
        json: input,
      });
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return response["user"];
    },

    async addAddress(input: Omit<PublicAddress, "id">) {
      const response = await client.request<unknown>("/users/me/addresses", {
        method: "POST",
        json: input,
      });
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return response["user"];
    },

    async updateAddress(addressId: string, input: Partial<Omit<PublicAddress, "id">>) {
      const response = await client.request<unknown>(
        `/users/me/addresses/${encodeURIComponent(addressId)}`,
        { method: "PATCH", json: input },
      );
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return response["user"];
    },

    async deleteAddress(addressId: string) {
      const response = await client.request<unknown>(
        `/users/me/addresses/${encodeURIComponent(addressId)}`,
        { method: "DELETE" },
      );
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return response["user"];
    },

    async setDefaultAddress(addressId: string) {
      const response = await client.request<unknown>(
        `/users/me/addresses/${encodeURIComponent(addressId)}/default`,
        { method: "PATCH", json: {} },
      );
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return response["user"];
    },

    async verifyLoginEmailOtp(code: string): Promise<LoginResponse> {
      const response = await client.request<unknown>("/auth/login/verify-email-otp", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
      if (isRecord(response) && response["twoFactorRequired"] === true && Object.keys(response).length === 1) {
        return { twoFactorRequired: true };
      }
      if (isRecord(response) && isPublicUser(response["user"])) {
        return { user: response["user"] };
      }
      return invalidAuthResponse();
    },

    resendLoginEmailOtp() {
      return client.request<unknown>("/auth/login/resend-email-otp", {
        method: "POST",
        json: {},
      });
    },

    logout() {
      return client.request<void>("/auth/logout", {
        method: "POST",
        regeneratesSession: true,
      });
    },

    async verifyTwoFactor(code: string) {
      const response = await client.request<unknown>("/auth/2fa/verify", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return { user: response["user"] };
    },

    async confirmTwoFactor(code: string) {
      const response = await client.request<unknown>("/auth/2fa/confirm", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
      if (
        !isRecord(response) ||
        response["twoFactorEnabled"] !== true ||
        !Array.isArray(response["recoveryCodes"]) ||
        !response["recoveryCodes"].every((entry) => typeof entry === "string")
      ) {
        return invalidAuthResponse();
      }
      return {
        twoFactorEnabled: true as const,
        recoveryCodes: response["recoveryCodes"].filter(
          (entry): entry is string => typeof entry === "string",
        ),
      };
    },

    async enrollTwoFactor() {
      const response = await client.request<unknown>("/auth/2fa/enroll", {
        method: "POST",
        json: {},
      });
      if (
        !isRecord(response) ||
        typeof response["secret"] !== "string" ||
        typeof response["provisioningUri"] !== "string"
      ) {
        return invalidAuthResponse();
      }
      return { secret: response["secret"], provisioningUri: response["provisioningUri"] };
    },
  };
}

let configuredAuthApi: ReturnType<typeof createAuthApi> | undefined;

function getConfiguredAuthApi() {
  configuredAuthApi ??= createAuthApi(createConfiguredApiClient());
  return configuredAuthApi;
}

export const authApi = {
  getSession: () => getConfiguredAuthApi().getSession(),
  login: (credentials: { email: string; password: string }) =>
    getConfiguredAuthApi().login(credentials),
  register: (input: Parameters<ReturnType<typeof createAuthApi>["register"]>[0]) =>
    getConfiguredAuthApi().register(input),
  requestVerification: (email: string) => getConfiguredAuthApi().requestVerification(email),
  verifyEmail: (token: string) => getConfiguredAuthApi().verifyEmail(token),
  forgotPassword: (email: string) => getConfiguredAuthApi().forgotPassword(email),
  resetPassword: (token: string, password: string) =>
    getConfiguredAuthApi().resetPassword(token, password),
  updateProfile: (input: { displayName?: string; phoneNumber?: string }) =>
    getConfiguredAuthApi().updateProfile(input),
  addAddress: (input: Omit<PublicAddress, "id">) => getConfiguredAuthApi().addAddress(input),
  updateAddress: (addressId: string, input: Partial<Omit<PublicAddress, "id">>) =>
    getConfiguredAuthApi().updateAddress(addressId, input),
  deleteAddress: (addressId: string) => getConfiguredAuthApi().deleteAddress(addressId),
  setDefaultAddress: (addressId: string) => getConfiguredAuthApi().setDefaultAddress(addressId),
  logout: () => getConfiguredAuthApi().logout(),
  verifyLoginEmailOtp: (code: string) => getConfiguredAuthApi().verifyLoginEmailOtp(code),
  resendLoginEmailOtp: () => getConfiguredAuthApi().resendLoginEmailOtp(),
  verifyTwoFactor: (code: string) => getConfiguredAuthApi().verifyTwoFactor(code),
  confirmTwoFactor: (code: string) => getConfiguredAuthApi().confirmTwoFactor(code),
  enrollTwoFactor: () => getConfiguredAuthApi().enrollTwoFactor(),
};
