-- Runner Order community: accounts, private cloud projects, and a public kit library.
-- Access is enforced here with row-level security, so the static site can use the public (anon) key.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Title and product-code normalisation, mirrored by normaliseTitle/normaliseCode in dist/cloud.js.
-- "Zaku II", "zaku-2" and "ZAKU 2" all become "zaku 2"; "Mk-II" and "MkII" become "mk 2".
create or replace function public.normalise_title(value text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g'),
      '\mmk(ii|iii|iv)\M', 'mk \1', 'g'),
      '\miv\M', '4', 'g'),
      '\miii\M', '3', 'g'),
      '\mii\M', '2', 'g'),
    '\s+', ' ', 'g'))
$$;

create or replace function public.normalise_code(value text) returns text
language sql immutable parallel safe as $$
  select nullif(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]', '', 'g'), '')
$$;

-- A kit's sections are [{ "name": text, "raw": text }]: the same names and part text the app edits.
create or replace function public.kit_sections_valid(sections jsonb) returns boolean
language plpgsql immutable as $$
declare item jsonb;
begin
  if jsonb_typeof(sections) <> 'array' or jsonb_array_length(sections) = 0 or jsonb_array_length(sections) > 200 then
    return false;
  end if;
  for item in select * from jsonb_array_elements(sections) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'name') <> 'string' or jsonb_typeof(item->'raw') <> 'string'
      or char_length(item->>'name') > 200 or char_length(item->>'raw') > 20000 then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Every new sign-in gets a profile named from Google, or from the email address before the @.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'Builder'), 40));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may rename themselves but never make themselves admins. Only requests from the website
-- (the anon and authenticated roles) are restricted; the Supabase dashboard can still manage admins.
create or replace function public.guard_profile() returns trigger
language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then new.is_admin := old.is_admin; end if;
  new.id := old.id; new.created_at := old.created_at;
  return new;
end $$;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------------
-- Private cloud copies of each person's saved projects. id is the browser library's entry id.
create table public.projects (
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(name) <= 200),
  data jsonb not null check (jsonb_typeof(data) = 'object' and jsonb_typeof(data->'sections') = 'array' and pg_column_size(data) < 512000),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (owner, id)
);

-- ---------------------------------------------------------------------------
create table public.brands (
  slug text primary key check (slug ~ '^[a-z0-9-]{1,40}$'),
  name text not null unique check (char_length(name) between 1 and 60),
  sort integer not null default 100
);
insert into public.brands (slug, name, sort) values
  ('bandai', 'Bandai', 1), ('motornuclear', 'MotorNuclear', 2), ('kotobukiya', 'Kotobukiya', 3),
  ('changlong', 'ChangLong', 4), ('fatcat', 'Fat Cat', 5), ('good-smile', 'Good Smile', 6),
  ('hasegawa', 'Hasegawa', 7), ('wave', 'Wave', 8), ('daban', 'Daban', 9), ('other', 'Other', 999);

create table public.kits (
  id uuid primary key default gen_random_uuid(),
  owner uuid default auth.uid() references auth.users (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  title_key text generated always as (public.normalise_title(title)) stored,
  brand text not null references public.brands (slug) on update cascade,
  brand_other text check (char_length(brand_other) <= 60),
  scale text not null check (scale in ('1/144', '1/100', '1/60', '1/72', '1/48', '1/35', 'non-scale', 'other')),
  line text check (char_length(line) <= 40),
  series text check (char_length(series) <= 80),
  product_code text check (char_length(product_code) <= 40),
  product_key text generated always as (public.normalise_code(product_code)) stored,
  notes text check (char_length(notes) <= 1000),
  sections jsonb not null check (public.kit_sections_valid(sections) and pg_column_size(sections) < 256000),
  part_count integer not null check (part_count between 1 and 5000),
  status text not null default 'published' check (status in ('published', 'hidden', 'removed')),
  confirmations_count integer not null default 0,
  reports_count integer not null default 0,
  duplicate_of uuid references public.kits (id) on delete set null,
  forked_from uuid references public.kits (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (brand <> 'other' or char_length(btrim(coalesce(brand_other, ''))) > 0)
);
create index kits_title_trgm on public.kits using gin (title_key extensions.gin_trgm_ops);
create index kits_product_key on public.kits (product_key);
create index kits_browse on public.kits (status, brand, scale, created_at desc);

-- Owners edit their kit's content; status, counts and moderation fields belong to admins and triggers.
-- Updates made by other triggers (report and confirmation counts) run nested and skip this guard,
-- as do edits made directly in the Supabase dashboard.
create or replace function public.guard_kit() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if current_user not in ('anon', 'authenticated') then new.updated_at := now(); return new; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is null then raise exception 'Sign in to share a kit.'; end if;
    if (select count(*) from public.kits where owner = auth.uid() and created_at > now() - interval '1 day') >= 10 then
      raise exception 'You can share up to 10 kits a day. Please try again tomorrow.';
    end if;
    new.owner := auth.uid();
    new.status := 'published'; new.confirmations_count := 0; new.reports_count := 0; new.duplicate_of := null;
    new.created_at := now();
  elsif not public.is_admin() then
    new.owner := old.owner; new.status := old.status; new.confirmations_count := old.confirmations_count;
    new.reports_count := old.reports_count; new.duplicate_of := old.duplicate_of;
    new.forked_from := old.forked_from; new.created_at := old.created_at;
  end if;
  if new.brand <> 'other' then new.brand_other := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_kit before insert or update on public.kits
  for each row execute function public.guard_kit();

-- ---------------------------------------------------------------------------
create table public.kit_reports (
  kit_id uuid not null references public.kits (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null check (reason in ('wrong-parts', 'duplicate', 'spam', 'offensive', 'other')),
  details text check (char_length(details) <= 500),
  created_at timestamptz not null default now(),
  primary key (kit_id, reporter)
);

-- The third report hides a kit until an admin reviews it.
create or replace function public.count_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.kits set reports_count = reports_count + 1,
    status = case when reports_count + 1 >= 3 and status = 'published' then 'hidden' else status end
  where id = new.kit_id;
  return new;
end $$;
create trigger count_report after insert on public.kit_reports
  for each row execute function public.count_report();

create table public.kit_confirmations (
  kit_id uuid not null references public.kits (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kit_id, user_id)
);

create or replace function public.count_confirmation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.kits set confirmations_count = (select count(*) from public.kit_confirmations where kit_id = coalesce(new.kit_id, old.kit_id))
  where id = coalesce(new.kit_id, old.kit_id);
  return null;
end $$;
create trigger count_confirmation after insert or delete on public.kit_confirmations
  for each row execute function public.count_confirmation();

-- ---------------------------------------------------------------------------
-- Row-level security
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.brands enable row level security;
alter table public.kits enable row level security;
alter table public.kit_reports enable row level security;
alter table public.kit_confirmations enable row level security;

create policy "Profiles are public" on public.profiles for select using (true);
create policy "Users edit their own profile" on public.profiles for update using (id = auth.uid() or public.is_admin());

create policy "Owners read their projects" on public.projects for select using (owner = auth.uid());
create policy "Owners add projects" on public.projects for insert with check (owner = auth.uid());
create policy "Owners update projects" on public.projects for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "Owners delete projects" on public.projects for delete using (owner = auth.uid());

create policy "Brands are public" on public.brands for select using (true);
create policy "Admins manage brands" on public.brands for all using (public.is_admin()) with check (public.is_admin());

create policy "Published kits are public" on public.kits for select
  using (status = 'published' or owner = auth.uid() or public.is_admin());
create policy "Signed-in users share kits" on public.kits for insert with check (auth.uid() is not null);
create policy "Owners and admins update kits" on public.kits for update
  using (owner = auth.uid() or public.is_admin()) with check (owner = auth.uid() or public.is_admin());
create policy "Admins delete kits" on public.kits for delete using (public.is_admin());

create policy "Users report kits" on public.kit_reports for insert with check (reporter = auth.uid());
create policy "Reporters and admins read reports" on public.kit_reports for select using (reporter = auth.uid() or public.is_admin());

create policy "Users confirm kits" on public.kit_confirmations for insert with check (user_id = auth.uid());
create policy "Users see their confirmations" on public.kit_confirmations for select using (user_id = auth.uid());
create policy "Users withdraw confirmations" on public.kit_confirmations for delete using (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.brands, public.kits to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant insert, update, delete on public.brands to authenticated;
grant insert, update, delete on public.kits to authenticated;
grant select, insert on public.kit_reports to authenticated;
grant select, insert, delete on public.kit_confirmations to authenticated;

-- ---------------------------------------------------------------------------
-- Library search, used by the Community kits page and the New project pre-check.
-- Returns summaries only (no sections) so results stay small.
create or replace function public.search_kits(
  q text default '', p_brand text default null, p_scale text default null, p_line text default null,
  p_sort text default 'relevance', p_limit integer default 30, p_offset integer default 0
) returns table (
  id uuid, title text, brand text, brand_name text, brand_other text, scale text, line text, series text,
  product_code text, part_count integer, confirmations_count integer, owner_name text, created_at timestamptz,
  exact_code boolean, score real
)
language sql stable set search_path = public, extensions as $$
  with query as (select public.normalise_title(q) as t, public.normalise_code(q) as c)
  select k.id, k.title, k.brand, b.name, k.brand_other, k.scale, k.line, k.series, k.product_code, k.part_count,
    k.confirmations_count, p.display_name, k.created_at,
    coalesce(k.product_key = query.c, false) as exact_code,
    case when query.t = '' then 0 else greatest(similarity(k.title_key, query.t), word_similarity(query.t, k.title_key)) end as score
  from public.kits k cross join query
  join public.brands b on b.slug = k.brand
  left join public.profiles p on p.id = k.owner
  where k.status = 'published'
    and (p_brand is null or k.brand = p_brand)
    and (p_scale is null or k.scale = p_scale)
    and (p_line is null or lower(k.line) = lower(p_line))
    and (query.t = '' or k.product_key = query.c or k.title_key like '%' || query.t || '%'
         or similarity(k.title_key, query.t) > 0.3 or word_similarity(query.t, k.title_key) > 0.5)
  order by
    exact_code desc,
    case when p_sort = 'newest' then extract(epoch from k.created_at) end desc nulls last,
    case when p_sort = 'confirmed' then k.confirmations_count end desc nulls last,
    score desc, k.confirmations_count desc, k.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;
grant execute on function public.search_kits to anon, authenticated;

-- Removes the signed-in account. Projects go with it; shared kits stay, anonymously, as the licence allows.
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_account from public, anon;
grant execute on function public.delete_account to authenticated;

-- Admin: fold a duplicate kit into the one being kept.
create or replace function public.merge_kits(duplicate uuid, keep uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if duplicate = keep then raise exception 'Choose two different kits.'; end if;
  insert into public.kit_confirmations (kit_id, user_id, created_at)
    select keep, user_id, created_at from public.kit_confirmations where kit_id = duplicate
    on conflict do nothing;
  update public.kits set status = 'removed', duplicate_of = keep where id = duplicate;
end $$;

-- Admin: turn a typed-in "Other" brand into a proper brand and re-file its kits.
create or replace function public.promote_brand(other_name text, new_slug text, new_name text) returns integer
language plpgsql security definer set search_path = public as $$
declare moved integer;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  insert into public.brands (slug, name) values (new_slug, new_name) on conflict (slug) do nothing;
  update public.kits set brand = new_slug, brand_other = null
    where brand = 'other' and lower(btrim(brand_other)) = lower(btrim(other_name));
  get diagnostics moved = row_count;
  return moved;
end $$;
revoke execute on function public.merge_kits, public.promote_brand from public, anon;
grant execute on function public.merge_kits, public.promote_brand to authenticated;
