import localFont from "next/font/local";

const geist = localFont({
  src: "./fonts/GeistVF.woff",
  display: "swap",
});

import "@/app/_styles/globals.css";
import Header from "./_components/Header";
import { ReservationProvider } from "./_components/ReservationContext";
import ConciergePanel from "./_components/concierge/ConciergePanel";

export const metadata = {
  title: {
    template: "%s / The Wild Oasis",
    default: "Welcome / The Wild Oasis",
  },
  description:
    "Luxurious cabin hotel, surrounded by beautiful mountains and dark forests",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geist.className} antialiased bg-primary-950 text-primary-100 min-h-screen flex flex-col relative`}
      >
        <ReservationProvider>
          <Header />

          <div className="flex-1 px-8 py-12 grid ">
            <main className="max-w-7xl mx-auto  w-full ">{children}</main>
          </div>
          <ConciergePanel />
        </ReservationProvider>
      </body>
    </html>
  );
}
