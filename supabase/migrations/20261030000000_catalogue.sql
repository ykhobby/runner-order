-- Kit catalogue support: which catalogue kits already have a shared parts list, matched by product code.

-- One row per product code with at least one published kit; small enough to load once per visit.
create or replace function public.kit_code_counts() returns table (product_key text, kits integer)
language sql stable set search_path = public as $$
  select k.product_key, count(*)::integer from public.kits k
  where k.status = 'published' and k.product_key is not null
  group by k.product_key
$$;
grant execute on function public.kit_code_counts to anon, authenticated;

-- The line filter now matches a grade family, so "HG" also finds HGUC, HGCE and HGBF kits.
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
    and (p_line is null or lower(k.line) like lower(p_line) || '%')
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
