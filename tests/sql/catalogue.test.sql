-- Catalogue support: parts-list counts by product code, and grade-family line filtering. Runs after rls.test.sql.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'eve@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
insert into kits (title, brand, scale, line, product_code, sections, part_count)
values ('GM Sniper II', 'bandai', '1/144', 'HGUC', '2346809', '[{"name":"Body","raw":"A1"}]', 1),
       ('GM Sniper II (corrected)', 'bandai', '1/144', 'HGUC', '2346-809', '[{"name":"Body","raw":"A1 A2"}]', 2);
reset role; set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  assert (select kits from kit_code_counts() where product_key = '2346809') = 2, 'both kits counted under one product code';
  assert (select count(*) from kit_code_counts() where product_key is null) = 0, 'kits without a code are not counted';
  assert (select count(*) from search_kits('gm sniper', p_line => 'hg')) = 2, 'HG finds the HGUC kits';
  assert (select count(*) from search_kits('gm sniper', p_line => 'mg')) = 0, 'MG does not';
end $$;
-- Hidden kits do not count as having a parts list.
reset role;
update kits set status = 'hidden' where product_code = '2346-809';
set role anon;
do $$ begin
  assert (select kits from kit_code_counts() where product_key = '2346809') = 1, 'hidden kits are not counted';
end $$;
