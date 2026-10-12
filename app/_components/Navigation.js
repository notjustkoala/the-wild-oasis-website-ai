"use client";

import Link from "next/link";
import { useGuestSession } from "./GuestSessionProvider";

export default function Navigation() {
  const { user } = useGuestSession();

  return (
    <nav className="z-10 text-base sm:text-xl">
      <ul className="flex gap-6 sm:gap-16 items-center">
        <li>
          <Link
            href="/cabins"
            className="hover:text-accent-400 transition-colors"
          >
            Cabins
          </Link>
        </li>
        <li>
          <Link
            href="/about"
            className="hover:text-accent-400 transition-colors"
          >
            About
          </Link>
        </li>
        <li>
          {user?.image ? (
            <Link
              href="/account"
              className="hover:text-accent-400 transition-colors flex items-center gap-4"
            >
              <img
                src={user.image}
                className="h-8 rounded-full"
                alt={user.name ?? "Guest avatar"}
                referrerPolicy="no-referrer"
              />
              <span>Guest area</span>
            </Link>
          ) : (
            <Link
              href="/account"
              className="hover:text-accent-400 transition-colors"
            >
              Guest area
            </Link>
          )}
        </li>
      </ul>
    </nav>
  );
}
