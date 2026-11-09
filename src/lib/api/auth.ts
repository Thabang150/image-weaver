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
  addressType?: "residential" | "business";
  city: string;
  province: string;
  postalCode: string;
  country: string;
  lat?: number;
  lng?: number;
  deliveryInstructions?: string;
}

export type NewAddressInput = Omit<PublicAddress, "id" | "isDefault" | "localArea"> & {
  localArea: string;
};

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
  emailOtpRequired?: true;
  status: number;
}

export type SessionState =
  { status: "unauthenticated" } | { status: "authenticated"; user: PublicUser };

export type AuthApiClient = Pick<
  ReturnType<typeof createApiClient>,
  "request" | "requestWithStatus"
>;

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
    (value["addressType"] === undefined ||
      value["addressType"] === "residential" ||
      value["addressType"] === "business") &&
    typeof value["city"] === "string" &&
    typeof value["province"] === "string" &&
    typeof value["postalCode"] === "string" &&
    typeof value["country"] === "string" &&
    (value["lat"] === undefined ||
      (typeof value["lat"] === "number" &&
        Number.isFinite(value["lat"]) &&
        value["lat"] >= -90 &&
        value["lat"] <= 90)) &&
    (value["lng"] === undefined ||
      (typeof value["lng"] === "number" &&
        Number.isFinite(value["lng"]) &&
        value["lng"] >= -180 &&
        value["lng"] <= 180)) &&
    ((value["lat"] === undefined && value["lng"] === undefined) ||
      (value["lat"] !== undefined &&
        value["lng"] !== undefined &&
        !(value["lat"] === 0 && value["lng"] === 0))) &&
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

function parseRegistrationResult(
  response: unknown,
  status: number,
  expectEmailOtp = false,
): RegistrationResult {
  if (
    !isRecord(response) ||
    !isPublicUser(response["user"]) ||
    typeof response["emailVerificationEmailSent"] !== "boolean" ||
    (response["emailOtpRequired"] !== undefined && response["emailOtpRequired"] !== true) ||
    (expectEmailOtp && response["emailOtpRequired"] !== true)
  ) {
    return invalidAuthResponse();
  }
  return {
    user: response["user"],
    emailVerificationEmailSent: response["emailVerificationEmailSent"],
    ...(response["emailOtpRequired"] === true ? { emailOtpRequired: true } : {}),
    status,
  };
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
      displayName: string;
      phoneNumber?: string;
    }): Promise<RegistrationResult> {
      const { body, status } = await client.requestWithStatus<unknown>("/auth/register", {
        method: "POST",
        json: input,
        regeneratesSession: true,
      });
      return parseRegistrationResult(body, status, true);
    },

    async registerAdmin(input: {
      email: string;
      password: string;
      displayName?: string;
      phoneNumber?: string;
    }): Promise<RegistrationResult> {
      console.info("[admin-registration] Starting admin registration API call.");
      const { body, status } = await client.requestWithStatus<unknown>("/auth/admin/register", {
        method: "POST",
        json: {
          ...input,
          email: input.email.trim().toLowerCase(),
        },
      });
      return parseRegistrationResult(body, status);
    },

    async requestVerification(email: string): Promise<{ message: string }> {
      const response = await client.request<unknown>("/auth/request-verification", {
        method: "POST",
        json: { email },
        regeneratesSession: true,
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

    async verifyRegistrationEmailOtp(code: string): Promise<{ user: PublicUser }> {
      const response = await client.request<unknown>("/auth/register/verify-email-otp", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
      if (!isRecord(response) || !isPublicUser(response["user"])) return invalidAuthResponse();
      return { user: response["user"] };
    },

    async resendRegistrationEmailOtp(): Promise<{ emailOtpSent: true }> {
      const response = await client.request<unknown>("/auth/register/resend-email-otp", {
        method: "POST",
        json: {},
      });
      if (!isRecord(response) || response["emailOtpSent"] !== true) return invalidAuthResponse();
      return { emailOtpSent: true };
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

    async addAddress(input: NewAddressInput) {
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
      if (
        isRecord(response) &&
        response["twoFactorRequired"] === true &&
        Object.keys(response).length === 1
      ) {
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

    async getTwoFactorStatus(): Promise<{ twoFactorEnabled: boolean }> {
      const response = await client.request<unknown>("/auth/2fa/status");
      if (!isRecord(response) || typeof response["twoFactorEnabled"] !== "boolean") {
        return invalidAuthResponse();
      }
      return { twoFactorEnabled: response["twoFactorEnabled"] };
    },

    async rotateTwoFactorRecoveryCodes(code: string): Promise<{ recoveryCodes: string[] }> {
      const response = await client.request<unknown>("/auth/2fa/recovery-codes/rotate", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
      if (
        !isRecord(response) ||
        !Array.isArray(response["recoveryCodes"]) ||
        !response["recoveryCodes"].every((entry) => typeof entry === "string")
      ) {
        return invalidAuthResponse();
      }
      return { recoveryCodes: response["recoveryCodes"] };
    },

    async disableTwoFactor(code: string): Promise<{ twoFactorEnabled: false }> {
      const response = await client.request<unknown>("/auth/2fa/disable", {
        method: "POST",
        json: { code },
        regeneratesSession: true,
      });
      if (!isRecord(response) || response["twoFactorEnabled"] !== false) {
        return invalidAuthResponse();
      }
      return { twoFactorEnabled: false };
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
  registerAdmin: (input: Parameters<ReturnType<typeof createAuthApi>["registerAdmin"]>[0]) =>
    getConfiguredAuthApi().registerAdmin(input),
  requestVerification: (email: string) => getConfiguredAuthApi().requestVerification(email),
  verifyEmail: (token: string) => getConfiguredAuthApi().verifyEmail(token),
  verifyRegistrationEmailOtp: (code: string) =>
    getConfiguredAuthApi().verifyRegistrationEmailOtp(code),
  resendRegistrationEmailOtp: () => getConfiguredAuthApi().resendRegistrationEmailOtp(),
  forgotPassword: (email: string) => getConfiguredAuthApi().forgotPassword(email),
  resetPassword: (token: string, password: string) =>
    getConfiguredAuthApi().resetPassword(token, password),
  updateProfile: (input: { displayName?: string; phoneNumber?: string }) =>
    getConfiguredAuthApi().updateProfile(input),
  addAddress: (input: NewAddressInput) => getConfiguredAuthApi().addAddress(input),
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
  getTwoFactorStatus: () => getConfiguredAuthApi().getTwoFactorStatus(),
  rotateTwoFactorRecoveryCodes: (code: string) =>
    getConfiguredAuthApi().rotateTwoFactorRecoveryCodes(code),
  disableTwoFactor: (code: string) => getConfiguredAuthApi().disableTwoFactor(code),
};
