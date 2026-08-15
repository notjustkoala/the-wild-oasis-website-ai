import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { customFetch } from "@auth/core";
import authConfig from "./auth.config";
import { createGuest, getGuest } from "./data-service";
import { createProxyAwareFetch } from "./server-fetch";

const providerFetch = createProxyAwareFetch(process.env, {}, false);

export const {
  auth,
  signIn,
  signOut,
  handlers: { GET, POST },
} = NextAuth({
  ...authConfig,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      [customFetch]: providerFetch,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      try {
        const existingGuest = await getGuest(user.email);
        if (!existingGuest) {
          await createGuest({ email: user.email, fullName: user.name });
        }

        return true;
      } catch {
        return false;
      }
    },
    async session({ session, user }) {
      const guest = await getGuest(session.user.email);
      session.user.guestId = guest.id;
      return session;
    },
  },
});
