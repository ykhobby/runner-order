-- Access-rule tests for the community migration. Run with tests/sql/run.sh.
-- Users: A (becomes admin), B, C and D. Each block switches role the way Supabase does per request.

create schema test;
grant usage on schema test to anon, authenticated;
-- Runs a statement as the current role and fails unless it raises an error matching the pattern.
create function test.expect_error(statement text, pattern text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'Expected an error matching "%" from: %', pattern, statement;
exception when others then
  if sqlerrm like 'Expected an error%' or sqlerrm !~* pattern then raise; end if;
end $$;
grant execute on function test.expect_error to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com', '{"full_name": "Alice Builder"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'cat@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'dan@example.com', '{}');

do $$ begin
  assert (select display_name from profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alice Builder', 'Google name used';
  assert (select display_name from profiles where id = '00000000-0000-0000-0000-00000000000b') = 'bob', 'email prefix used';
  -- Title normalisation, mirrored in dist/cloud.js.
  assert normalise_title('Zaku II') = 'zaku 2' and normalise_title('zaku-2') = 'zaku 2' and normalise_title('ZAKU  2') = 'zaku 2', 'roman numerals';
  assert normalise_title('Gundam Mk-II') = 'gundam mk 2' and normalise_title('Gundam MkII') = 'gundam mk 2', 'Mk-II';
  assert normalise_title('RX-78-2 Gundam (Ver. 2.0)') = 'rx 78 2 gundam ver 2 0', 'punctuation';
  assert normalise_title('V Gundam') = 'v gundam', 'single V left alone';
  assert normalise_code(' 5060661 ') = '5060661' and normalise_code('BAN-2468') = 'ban2468', 'product codes';
end $$;

-- A saves a private project and shares a kit (trying to sneak in a hidden status and fake counts).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into projects (id, name, data) values ('p1', 'Zaku build', '{"version":1,"name":"Zaku build","view":"section","sections":[]}');
insert into kits (id, title, brand, scale, line, product_code, sections, part_count, status, confirmations_count)
values ('10000000-0000-0000-0000-000000000001', 'HG Zaku II', 'bandai', '1/144', 'HG', '5060661',
  '[{"name":"Head","raw":"A1 A2"}]', 2, 'hidden', 99);
do $$ begin
  assert (select status from kits where id = '10000000-0000-0000-0000-000000000001') = 'published', 'new kits are always published';
  assert (select confirmations_count from kits where id = '10000000-0000-0000-0000-000000000001') = 0, 'counts cannot be faked';
  assert (select owner from kits where id = '10000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-00000000000a', 'owner is the signed-in user';
end $$;
select test.expect_error($$insert into kits (title, brand, scale, sections, part_count) values ('Bad', 'bandai', '1/144', '[{"name":1}]', 1)$$, 'check constraint');
select test.expect_error($$insert into kits (title, brand, scale, sections, part_count) values ('Mystery kit', 'other', '1/100', '[{"name":"A","raw":"A1"}]', 1)$$, 'check constraint');
select test.expect_error($$update profiles set is_admin = true where id = auth.uid()$$, 'permission denied');

-- B cannot see or change A's private project or A's kit, and cannot moderate their own kit.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare n integer; begin
  assert (select count(*) from projects) = 0, 'B cannot read A''s projects';
  update kits set title = 'Vandalised' where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count; assert n = 0, 'B cannot edit A''s kit';
end $$;
select test.expect_error($$insert into projects (owner, id, name, data) values ('00000000-0000-0000-0000-00000000000a', 'p2', 'x', '{"sections":[]}')$$, 'row-level security');
insert into kits (id, title, brand, scale, sections, part_count)
values ('10000000-0000-0000-0000-000000000002', 'Zaku 2 (corrected)', 'bandai', '1/144', '[{"name":"Head","raw":"A1"}]', 1);
update kits set status = 'removed', reports_count = 0 where id = '10000000-0000-0000-0000-000000000002';
do $$ begin
  assert (select status from kits where id = '10000000-0000-0000-0000-000000000002') = 'published', 'owners cannot change status';
end $$;
insert into projects (id, name, data) values ('b1', 'Bob build', '{"sections":[]}');

-- Signed-out visitors can search and read published kits but cannot write anything.
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  assert (select count(*) from search_kits('zaku 2')) = 2, 'fuzzy title search finds both Zaku kits';
  assert (select title from search_kits('5060661') limit 1) = 'HG Zaku II', 'product code ranks first';
  assert (select exact_code from search_kits('5060661') limit 1), 'exact product-code match is flagged';
  assert (select count(*) from search_kits('', 'motornuclear')) = 0, 'brand filter';
  assert (select count(*) from search_kits('', 'bandai', '1/100')) = 0, 'scale filter';
  assert (select count(*) from search_kits('', 'bandai', '1/144', 'hg')) = 1, 'line filter ignores case';
end $$;
select test.expect_error($$select count(*) from projects$$, 'permission denied');
select test.expect_error($$insert into kits (title, brand, scale, sections, part_count) values ('Anon kit', 'bandai', '1/144', '[{"name":"A","raw":"A1"}]', 1)$$, 'permission denied');
select test.expect_error($$insert into kit_reports (kit_id, reason) values ('10000000-0000-0000-0000-000000000001', 'spam')$$, 'permission denied');

-- Three reports hide a kit; one report per person; owners still see their hidden kit.
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
insert into kit_reports (kit_id, reason) values ('10000000-0000-0000-0000-000000000001', 'wrong-parts');
select test.expect_error($$insert into kit_reports (kit_id, reason) values ('10000000-0000-0000-0000-000000000001', 'spam')$$, 'duplicate key');
insert into kit_confirmations (kit_id) values ('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into kit_reports (kit_id, reason) values ('10000000-0000-0000-0000-000000000001', 'spam');
insert into kit_confirmations (kit_id) values ('10000000-0000-0000-0000-000000000001');
do $$ begin
  assert (select confirmations_count from kits where id = '10000000-0000-0000-0000-000000000001') = 2, 'confirmations counted';
  assert (select count(*) from search_kits('zaku')) = 2, 'two reports keep it visible';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
insert into kit_reports (kit_id, reason) values ('10000000-0000-0000-0000-000000000001', 'offensive');
do $$ begin
  assert (select count(*) from kits where id = '10000000-0000-0000-0000-000000000001') = 0, 'third report hides it from others';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert (select status from kits where id = '10000000-0000-0000-0000-000000000001') = 'hidden', 'owner still sees the hidden kit';
  assert (select count(*) from kit_reports) = 0, 'owners cannot read who reported them';
end $$;
select test.expect_error($$select merge_kits('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$$, 'Admins only');

-- Daily sharing limit (A already shared one kit today).
do $$ begin
  for i in 1..9 loop
    insert into kits (title, brand, scale, sections, part_count) values ('Kit ' || i, 'bandai', '1/144', '[{"name":"A","raw":"A1"}]', 1);
  end loop;
end $$;
select test.expect_error($$insert into kits (title, brand, scale, sections, part_count) values ('Kit 11', 'bandai', '1/144', '[{"name":"A","raw":"A1"}]', 1)$$, 'up to 10 kits a day');

-- Admin moderation: restore, merge duplicates, promote a typed-in brand.
reset role;
update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update kits set status = 'published' where id = '10000000-0000-0000-0000-000000000001';
select merge_kits('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert (select status from kits where id = '10000000-0000-0000-0000-000000000001') = 'published', 'admin restored the kit';
  assert (select count(*) from kits where id = '10000000-0000-0000-0000-000000000002' and status = 'published') = 0, 'merged duplicate removed';
end $$;
select test.expect_error($$insert into kits (title, brand, brand_other, scale, sections, part_count) values ('Bad scale', 'other', 'Snail Shell', '1/12', '[{"name":"A","raw":"A1"}]', 1)$$, 'check constraint');
insert into kits (id, title, brand, brand_other, scale, sections, part_count)
values ('10000000-0000-0000-0000-000000000003', 'Some Mecha', 'other', 'Snail Shell', 'other', '[{"name":"A","raw":"A1"}]', 1);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert promote_brand('snail shell', 'snail-shell', 'Snail Shell') = 1, 'one kit re-filed';
  assert (select brand from kits where id = '10000000-0000-0000-0000-000000000003') = 'snail-shell', 'kit moved to the new brand';
end $$;

-- Deleting an account removes private projects but keeps shared kits, anonymously.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select delete_account();
reset role;
do $$ begin
  assert (select count(*) from projects where owner = '00000000-0000-0000-0000-00000000000b') = 0, 'projects deleted with the account';
  assert (select owner from kits where id = '10000000-0000-0000-0000-000000000003') is null, 'shared kit kept anonymously';
end $$;
