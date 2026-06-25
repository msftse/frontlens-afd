import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { authEnabled } from "@/lib/auth/enabled";

/**
 * Auth.js (NextAuth v5) with Microsoft Entra ID (SSO). Providers are only wired
 * when AUTH_MICROSOFT_ENTRA_ID_* env vars are present, so the app runs without a
 * login wall in dev and enforces SSO automatically once configured in Azure.
 *
 * To restrict access to a single tenant or directory group, add checks in the
 * `signIn` callback (e.g. inspect the `profile.tid` or group claims).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  providers: authEnabled()
    ? [
        MicrosoftEntraID({
          clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
          clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
          issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
        }),
      ]
    : [],
  callbacks: {
    async signIn({ profile }) {
      const allowedTenant = process.env.AUTH_ALLOWED_TENANT_ID;
      if (allowedTenant && profile?.tid && profile.tid !== allowedTenant) return false;
      return true;
    },
  },
});
