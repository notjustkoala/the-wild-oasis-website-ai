-- Generated file. Do not edit by hand.
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
  (1, '001', 2, 250, 0, '__CABIN_IMAGE_BASE_URL__/cabin-001.jpg', 'A secluded two-person cabin with a private deck, hot tub, fireplace, and full kitchen.'),
  (2, '002', 2, 350, 25, '__CABIN_IMAGE_BASE_URL__/cabin-002.jpg', 'A premium couples cabin with forest views, a king bed, spa shower, and private hot tub.'),
  (3, '003', 4, 300, 0, '__CABIN_IMAGE_BASE_URL__/cabin-003.jpg', 'A comfortable family cabin for four with two sleeping areas, a fireplace, and a private deck.'),
  (4, '004', 4, 500, 50, '__CABIN_IMAGE_BASE_URL__/cabin-004.jpg', 'A luxury family cabin with upgraded finishes, an equipped kitchen, and a spa-inspired deck.'),
  (5, '005', 6, 350, 0, '__CABIN_IMAGE_BASE_URL__/cabin-005.jpg', 'A spacious six-person cabin with a generous living area, en-suite rooms, and an outdoor hot tub.'),
  (6, '006', 6, 800, 100, '__CABIN_IMAGE_BASE_URL__/cabin-006.jpg', 'A premium group cabin with a gourmet kitchen, large fireplace, and private forest terrace.'),
  (7, '007', 8, 600, 100, '__CABIN_IMAGE_BASE_URL__/cabin-007.jpg', 'A large multi-family cabin with several living areas, a full kitchen, and mountain views.'),
  (8, '008', 10, 1400, 0, '__CABIN_IMAGE_BASE_URL__/cabin-008.jpg', 'The largest Wild Oasis cabin, with grand shared spaces, luxury bedrooms, and a panoramic deck.');

insert into public.settings
  (id, "minBookingLength", "maxBookingLength", "maxGuestsPerBooking", "breakfastPrice")
values
  (1, 3, 30, 10, 15);

insert into public.guests
  (id, "fullName", email, "nationalID", nationality, "countryFlag")
values
  (1, 'Jonas Schmedtmann', 'guest001@wild-oasis.example', 'WO000001', 'Portugal', 'https://flagcdn.com/pt.svg'),
  (2, 'Jonathan Smith', 'guest002@wild-oasis.example', 'WO000002', 'United Kingdom', 'https://flagcdn.com/gb.svg'),
  (3, 'Jonatan Johansson', 'guest003@wild-oasis.example', 'WO000003', 'Finland', 'https://flagcdn.com/fi.svg'),
  (4, 'Jonas Mueller', 'guest004@wild-oasis.example', 'WO000004', 'Germany', 'https://flagcdn.com/de.svg'),
  (5, 'Jonas Anderson', 'guest005@wild-oasis.example', 'WO000005', 'Bolivia', 'https://flagcdn.com/bo.svg'),
  (6, 'Jonathan Williams', 'guest006@wild-oasis.example', 'WO000006', 'United States', 'https://flagcdn.com/us.svg'),
  (7, 'Emma Watson', 'guest007@wild-oasis.example', 'WO000007', 'United Kingdom', 'https://flagcdn.com/gb.svg'),
  (8, 'Mohammed Ali', 'guest008@wild-oasis.example', 'WO000008', 'Egypt', 'https://flagcdn.com/eg.svg'),
  (9, 'Maria Rodriguez', 'guest009@wild-oasis.example', 'WO000009', 'Spain', 'https://flagcdn.com/es.svg'),
  (10, 'Li Mei', 'guest010@wild-oasis.example', 'WO000010', 'China', 'https://flagcdn.com/cn.svg'),
  (11, 'Khadija Ahmed', 'guest011@wild-oasis.example', 'WO000011', 'Sudan', 'https://flagcdn.com/sd.svg'),
  (12, 'Gabriel Silva', 'guest012@wild-oasis.example', 'WO000012', 'Brazil', 'https://flagcdn.com/br.svg'),
  (13, 'Maria Gomez', 'guest013@wild-oasis.example', 'WO000013', 'Mexico', 'https://flagcdn.com/mx.svg'),
  (14, 'Ahmed Hassan', 'guest014@wild-oasis.example', 'WO000014', 'Egypt', 'https://flagcdn.com/eg.svg'),
  (15, 'John Doe', 'guest015@wild-oasis.example', 'WO000015', 'United States', 'https://flagcdn.com/us.svg'),
  (16, 'Fatima Ahmed', 'guest016@wild-oasis.example', 'WO000016', 'Pakistan', 'https://flagcdn.com/pk.svg'),
  (17, 'David Smith', 'guest017@wild-oasis.example', 'WO000017', 'Australia', 'https://flagcdn.com/au.svg'),
  (18, 'Marie Dupont', 'guest018@wild-oasis.example', 'WO000018', 'France', 'https://flagcdn.com/fr.svg'),
  (19, 'Ramesh Patel', 'guest019@wild-oasis.example', 'WO000019', 'India', 'https://flagcdn.com/in.svg'),
  (20, 'Fatimah Al-Sayed', 'guest020@wild-oasis.example', 'WO000020', 'Kuwait', 'https://flagcdn.com/kw.svg'),
  (21, 'Nina Williams', 'guest021@wild-oasis.example', 'WO000021', 'South Africa', 'https://flagcdn.com/za.svg'),
  (22, 'Taro Tanaka', 'guest022@wild-oasis.example', 'WO000022', 'Japan', 'https://flagcdn.com/jp.svg'),
  (23, 'Abdul Rahman', 'guest023@wild-oasis.example', 'WO000023', 'Saudi Arabia', 'https://flagcdn.com/sa.svg'),
  (24, 'Julie Nguyen', 'guest024@wild-oasis.example', 'WO000024', 'Vietnam', 'https://flagcdn.com/vn.svg'),
  (25, 'Sara Lee', 'guest025@wild-oasis.example', 'WO000025', 'South Korea', 'https://flagcdn.com/kr.svg'),
  (26, 'Carlos Gomez', 'guest026@wild-oasis.example', 'WO000026', 'Colombia', 'https://flagcdn.com/co.svg'),
  (27, 'Emma Brown', 'guest027@wild-oasis.example', 'WO000027', 'Canada', 'https://flagcdn.com/ca.svg'),
  (28, 'Juan Hernandez', 'guest028@wild-oasis.example', 'WO000028', 'Argentina', 'https://flagcdn.com/ar.svg'),
  (29, 'Ibrahim Ahmed', 'guest029@wild-oasis.example', 'WO000029', 'Nigeria', 'https://flagcdn.com/ng.svg'),
  (30, 'Mei Chen', 'guest030@wild-oasis.example', 'WO000030', 'Taiwan', 'https://flagcdn.com/tw.svg');

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
