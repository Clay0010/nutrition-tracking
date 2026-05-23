create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calories_target numeric not null default 2200,
  protein_target numeric not null default 160,
  carbs_target numeric not null default 220,
  fat_target numeric not null default 70,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  name text not null,
  serving text not null,
  quantity numeric not null,
  calories numeric not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  note text not null default '',
  source text not null,
  source_ref text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.custom_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  serving text not null,
  category text not null,
  calories numeric not null,
  protein numeric not null,
  carbs numeric not null,
  fat numeric not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.food_entries enable row level security;
alter table public.custom_foods enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "food_entries_select_own"
on public.food_entries
for select
to authenticated
using (auth.uid() = user_id);

create policy "food_entries_insert_own"
on public.food_entries
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "food_entries_update_own"
on public.food_entries
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "food_entries_delete_own"
on public.food_entries
for delete
to authenticated
using (auth.uid() = user_id);

create policy "custom_foods_select_own"
on public.custom_foods
for select
to authenticated
using (auth.uid() = user_id);

create policy "custom_foods_insert_own"
on public.custom_foods
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "custom_foods_update_own"
on public.custom_foods
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "custom_foods_delete_own"
on public.custom_foods
for delete
to authenticated
using (auth.uid() = user_id);
