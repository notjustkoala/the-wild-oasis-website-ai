import Google from "next-auth/providers/google";

const authConfig = {
  trustHost: true,
  debug: process.env.AUTH_DEBUG === "true",
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  pages: {
    signIn: "/login",
  },
};

export default authConfig;
