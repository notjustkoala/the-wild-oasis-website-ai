"use client";

import { useEffect, useState } from "react";
import CabinList from "./CabinList";
import Filter from "./Filter";

function capacityFilter(value) {
  return ["small", "medium", "large"].includes(value) ? value : "all";
}

export default function CabinCatalog({ cabins }) {
  // The default list is prerendered. Query-string filtering is only UI state,
  // and must not make the server page depend on request-time searchParams.
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const sync = () => setFilter(capacityFilter(new URLSearchParams(window.location.search).get("capacity")));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function selectFilter(value) {
    const next = capacityFilter(value);
    const url = new URL(window.location.href);
    url.searchParams.set("capacity", next);
    window.history.replaceState(null, "", url);
    setFilter(next);
  }
  return <>
    <div className="flex justify-end mb-8"><Filter activeFilter={filter} onFilter={selectFilter} /></div>
    <CabinList cabins={cabins} filter={filter} />
  </>;
}
