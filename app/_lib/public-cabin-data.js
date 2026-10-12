import "server-only";
import { unstable_cache } from "next/cache";
import { getCabin, getCabins } from "./data-service";

// Only public presentation data belongs here. Availability, settings and user
// sessions must never enter this shared cache.
export const getPublicCabins = unstable_cache(getCabins, ["public-cabins-v1"], {
  revalidate: 3600,
  tags: ["public-cabins"],
});

export const getPublicCabin = unstable_cache(getCabin, ["public-cabin-v1"], {
  revalidate: 3600,
  tags: ["public-cabins"],
});
