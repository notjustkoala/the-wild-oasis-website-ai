import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { sqlLiteral } from "./generate-demo-data.mjs";

export const BASE_IMAGE_URL_TOKEN = "__CABIN_IMAGE_BASE_URL__";
export const BASE_CABIN_COUNT = 8;
export const BASE_GUEST_COUNT = 30;
export const BASE_SETTINGS_ID = 1;

const CABIN_SOURCE = Object.freeze([
  ["001", 2, 250, 0, "A secluded two-person cabin with a private deck, hot tub, fireplace, and full kitchen."],
  ["002", 2, 350, 25, "A premium couples cabin with forest views, a king bed, spa shower, and private hot tub."],
  ["003", 4, 300, 0, "A comfortable family cabin for four with two sleeping areas, a fireplace, and a private deck."],
  ["004", 4, 500, 50, "A luxury family cabin with upgraded finishes, an equipped kitchen, and a spa-inspired deck."],
  ["005", 6, 350, 0, "A spacious six-person cabin with a generous living area, en-suite rooms, and an outdoor hot tub."],
  ["006", 6, 800, 100, "A premium group cabin with a gourmet kitchen, large fireplace, and private forest terrace."],
  ["007", 8, 600, 100, "A large multi-family cabin with several living areas, a full kitchen, and mountain views."],
  ["008", 10, 1400, 0, "The largest Wild Oasis cabin, with grand shared spaces, luxury bedrooms, and a panoramic deck."],
]);

const GUEST_SOURCE = Object.freeze([
  ["Jonas Schmedtmann", "Portugal", "pt"],
  ["Jonathan Smith", "United Kingdom", "gb"],
  ["Jonatan Johansson", "Finland", "fi"],
  ["Jonas Mueller", "Germany", "de"],
  ["Jonas Anderson", "Bolivia", "bo"],
  ["Jonathan Williams", "United States", "us"],
  ["Emma Watson", "United Kingdom", "gb"],
  ["Mohammed Ali", "Egypt", "eg"],
  ["Maria Rodriguez", "Spain", "es"],
  ["Li Mei", "China", "cn"],
  ["Khadija Ahmed", "Sudan", "sd"],
  ["Gabriel Silva", "Brazil", "br"],
  ["Maria Gomez", "Mexico", "mx"],
  ["Ahmed Hassan", "Egypt", "eg"],
  ["John Doe", "United States", "us"],
  ["Fatima Ahmed", "Pakistan", "pk"],
  ["David Smith", "Australia", "au"],
  ["Marie Dupont", "France", "fr"],
  ["Ramesh Patel", "India", "in"],
  ["Fatimah Al-Sayed", "Kuwait", "kw"],
  ["Nina Williams", "South Africa", "za"],
  ["Taro Tanaka", "Japan", "jp"],
  ["Abdul Rahman", "Saudi Arabia", "sa"],
  ["Julie Nguyen", "Vietnam", "vn"],
  ["Sara Lee", "South Korea", "kr"],
  ["Carlos Gomez", "Colombia", "co"],
  ["Emma Brown", "Canada", "ca"],
  ["Juan Hernandez", "Argentina", "ar"],
  ["Ibrahim Ahmed", "Nigeria", "ng"],
  ["Mei Chen", "Taiwan", "tw"],
]);

export const BASE_CABINS = Object.freeze(
  CABIN_SOURCE.map(([name, maxCapacity, regularPrice, discount, description], index) => ({
    id: index + 1,
    name,
    maxCapacity,
    regularPrice,
    discount,
    imageFile: `cabin-${name}.jpg`,
    description,
  }))
);

export const BASE_GUESTS = Object.freeze(
  GUEST_SOURCE.map(([fullName, nationality, countryCode], index) => ({
    id: index + 1,
    fullName,
    email: `guest${String(index + 1).padStart(3, "0")}@wild-oasis.example`,
    nationalID: `WO${String(index + 1).padStart(6, "0")}`,
    nationality,
    countryFlag: `https://flagcdn.com/${countryCode}.svg`,
  }))
);

export const BASE_SETTINGS = Object.freeze({
  id: BASE_SETTINGS_ID,
  minBookingLength: 3,
  maxBookingLength: 30,
  maxGuestsPerBooking: 10,
  breakfastPrice: 15,
});

export function normalizeImageBaseUrl(value) {
  if (value === BASE_IMAGE_URL_TOKEN) return value;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("An image base URL or the safe template token is required");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Image base URL must be a valid URL");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith(".supabase.co") ||
    normalizedPath !== "/storage/v1/object/public/cabin-images"
  ) {
    throw new Error(
      "Image base URL must be the HTTPS public cabin-images URL of a Supabase project"
    );
  }

  return `${parsed.origin}${normalizedPath}`;
}

function rowSql(values) {
  return `(${values.map(sqlLiteral).join(", ")})`;
}

export function renderBaseSeedSql({ imageBaseUrl = BASE_IMAGE_URL_TOKEN } = {}) {
  const safeImageBaseUrl = normalizeImageBaseUrl(imageBaseUrl);
  const cabinRows = BASE_CABINS.map((cabin) =>
    rowSql([
      cabin.id,
      cabin.name,
      cabin.maxCapacity,
      cabin.regularPrice,
      cabin.discount,
      `${safeImageBaseUrl}/${cabin.imageFile}`,
      cabin.description,
    ])
  ).join(",\n  ");
  const guestRows = BASE_GUESTS.map((guest) =>
    rowSql([
      guest.id,
      guest.fullName,
      guest.email,
      guest.nationalID,
      guest.nationality,
      guest.countryFlag,
    ])
  ).join(",\n  ");

  return `-- Generated file. Do not edit by hand.
-- Reproduce template: npm run seed:base -- --write --output=supabase/base-seed.sql
-- Before an authorized remote apply, render the token into an ignored generated file.

begin;

do $base_seed_prerequisites$
begin
  if exists (select 1 from public.cabins) then
    raise exception 'Base seed requires an empty public.cabins table';
  end if;
  if exists (select 1 from public.settings) then
    raise exception 'Base seed requires an empty public.settings table';
  end if;
  if exists (select 1 from public.guests) then
    raise exception 'Base seed requires an empty public.guests table';
  end if;
  if exists (select 1 from public.bookings) then
    raise exception 'Base seed must run before the bookings seed';
  end if;
end
$base_seed_prerequisites$;

insert into public.cabins
  (id, name, "maxCapacity", "regularPrice", discount, image, description)
values
  ${cabinRows};

insert into public.settings
  (id, "minBookingLength", "maxBookingLength", "maxGuestsPerBooking", "breakfastPrice")
values
  ${rowSql([
    BASE_SETTINGS.id,
    BASE_SETTINGS.minBookingLength,
    BASE_SETTINGS.maxBookingLength,
    BASE_SETTINGS.maxGuestsPerBooking,
    BASE_SETTINGS.breakfastPrice,
  ])};

insert into public.guests
  (id, "fullName", email, "nationalID", nationality, "countryFlag")
values
  ${guestRows};

select setval(pg_get_serial_sequence('public.cabins', 'id'), 8, true);
select setval(pg_get_serial_sequence('public.settings', 'id'), 1, true);
select setval(pg_get_serial_sequence('public.guests', 'id'), 30, true);

do $base_seed_postconditions$
begin
  if (select count(*) from public.cabins) <> 8 then
    raise exception 'Base seed expected exactly 8 cabins';
  end if;
  if (select count(*) from public.settings where id = 1) <> 1 then
    raise exception 'Base seed expected settings singleton id=1';
  end if;
  if (select count(*) from public.guests) <> 30 then
    raise exception 'Base seed expected exactly 30 guests';
  end if;
  if (select count(distinct email) from public.guests) <> 30 then
    raise exception 'Base seed guest emails must be unique';
  end if;
end
$base_seed_postconditions$;

commit;
`;
}

export function buildBaseSeedSummary() {
  const source = { cabins: BASE_CABINS, settings: BASE_SETTINGS, guests: BASE_GUESTS };
  return {
    cabins: BASE_CABINS.length,
    settings: 1,
    guests: BASE_GUESTS.length,
    uniqueGuestEmails: new Set(BASE_GUESTS.map((guest) => guest.email)).size,
    checksum: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
  };
}

export function parseBaseSeedCliArgs(args) {
  const options = {
    dryRun: true,
    output: null,
    stdout: false,
    imageBaseUrl: BASE_IMAGE_URL_TOKEN,
  };
  const blocked = [
    "--apply",
    "--remote",
    "--project-ref",
    "--production",
    "--db-url",
    "--linked",
  ];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (blocked.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      throw new Error("Remote database writes are intentionally unsupported");
    }
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--write") options.dryRun = false;
    else if (arg === "--stdout") options.stdout = true;
    else if (arg === "--output") options.output = args[++index];
    else if (arg.startsWith("--output=")) options.output = arg.slice(9);
    else if (arg === "--image-base-url") options.imageBaseUrl = args[++index];
    else if (arg.startsWith("--image-base-url=")) options.imageBaseUrl = arg.slice(17);
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.dryRun && !options.output) {
    throw new Error("--write requires an explicit --output path");
  }
  if (options.stdout && !options.dryRun) {
    throw new Error("--stdout cannot be combined with --write");
  }
  return options;
}

export function resolveBaseSeedOutputPath(cwd, output) {
  if (!output) throw new Error("An output path is required");
  const outputPath = resolve(cwd, output);
  const generatedRoot = resolve(cwd, "supabase", "generated");
  const pathFromGeneratedRoot = relative(generatedRoot, outputPath);
  const isGenerated =
    pathFromGeneratedRoot !== "" &&
    pathFromGeneratedRoot !== ".." &&
    !pathFromGeneratedRoot.startsWith(`..${sep}`);
  const isVersionedTemplate = outputPath === resolve(cwd, "supabase", "base-seed.sql");
  if (!isGenerated && !isVersionedTemplate) {
    throw new Error("Output must be supabase/base-seed.sql or inside supabase/generated/");
  }
  return { outputPath, isVersionedTemplate };
}

export async function runBaseSeedCli(args = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseBaseSeedCliArgs(args);
  const imageBaseUrl = normalizeImageBaseUrl(options.imageBaseUrl);
  const content = renderBaseSeedSql({ imageBaseUrl });
  const summary = {
    ...buildBaseSeedSummary(),
    mode: options.dryRun ? "dry-run" : "local-file-write",
    imageMode: imageBaseUrl === BASE_IMAGE_URL_TOKEN ? "template" : "rendered-target",
    output: options.output,
  };

  if (!options.dryRun) {
    const { outputPath, isVersionedTemplate } = resolveBaseSeedOutputPath(cwd, options.output);
    if (isVersionedTemplate && imageBaseUrl !== BASE_IMAGE_URL_TOKEN) {
      throw new Error("The versioned base seed must retain the safe image URL token");
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");
  }

  if (options.stdout) process.stdout.write(content);
  else process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runBaseSeedCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
