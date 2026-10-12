import Reservation from "@/app/_components/Reservation";
import Cabin from "@/app/_components/Cabin";
import { getPublicCabin, getPublicCabins } from "@/app/_lib/public-cabin-data";

export const dynamic = "error";
export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const cabins = await getPublicCabins();
  return cabins.map(cabin => ({ cabinId: String(cabin.id) }));
}

export async function generateMetadata({ params }) {
  const { name } = await getPublicCabin(params.cabinId);
  return { title: `Cabin ${name}` };
}

export default async function Page({ params }) {
  const cabin = await getPublicCabin(params.cabinId);

  return (
    <div className="max-w-6xl mx-auto mt-8">
      <Cabin cabin={cabin} />
      <div>
        <h2 className="text-5xl font-semibold text-center mb-10 text-accent-400">
          Reserve {cabin.name} today. Pay on arrival.
        </h2>

        <Reservation cabinId={cabin.id} />
      </div>
    </div>
  );
}
