import CabinCatalog from "../_components/CabinCatalog";
import { getPublicCabins } from "../_lib/public-cabin-data";
import ReservationReminder from "../_components/ReservationReminder";

export const metadata = {
  title: "Cabins",
};

export const dynamic = "error";
export const revalidate = 3600;

export default async function Page() {
  const cabins = await getPublicCabins();

  return (
    <div>
      <h1 className="text-4xl mb-5 text-accent-400 font-medium">
        Our Luxury Cabins
      </h1>
      <p className="text-primary-200 text-lg mb-10">
        Cozy yet luxurious cabins, located right in the heart of the Italian
        Dolomites. Imagine waking up to beautiful mountain views, spending your
        days exploring the dark forests around, or just relaxing in your private
        hot tub under the stars. Enjoy nature&apos;s beauty in your own little
        home away from home. The perfect spot for a peaceful, calm vacation.
        Welcome to paradise.
      </p>

      <CabinCatalog cabins={cabins} />
      <ReservationReminder />
    </div>
  );
}
