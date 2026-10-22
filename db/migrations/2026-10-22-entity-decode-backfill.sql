-- 2026-10-22 — backfill undecoded HTML character references.
--
-- The old stripHtml() in supabase/functions/poll/index.ts stripped decimal
-- numeric references (&#233;) instead of decoding them, and never touched hex
-- numeric ones (&#xe9;) at all — the latter is the live bug (Montr&#xe9;al
-- rendering literally on the site). Confirmed in production, read-only, before
-- writing this file: 21 rows in items.title and 24 in item_sources.title match
-- /&(#x[0-9a-f]+|#\d+|[a-zA-Z]+);/i; items.summary, items.snippet and
-- sources.name have zero matches, so they are left out below rather than run a
-- no-op UPDATE over the whole table.
--
-- DO NOT RUN THIS AGAINST PRODUCTION WITHOUT REVIEW. It is written for the
-- operator to review and apply by hand (or for CI to run after review), not for
-- an agent to execute. Apply AFTER deploying the poll build from this branch
-- (agent/entity-decode-2026-10-22) — this only fixes rows already in the
-- database; the deploy is what stops new ones from arriving broken.
--
-- Backs up the exact rows it is about to change (id + old value) before
-- touching them, decodes in place with the same semantics as
-- supabase/functions/poll/entities.ts (decimal + hex numeric references, the
-- six XML/HTML named ones that actually leak into feeds, anything else left
-- exactly as written), then drops the helper function — nothing permanent is
-- added to the schema. Idempotent: a second run finds no remaining matches and
-- updates zero rows.
begin;

create table if not exists items_title_entity_backfill_2026_10_22_bak as
  select id, title as old_title
  from items
  where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
  with no data;
insert into items_title_entity_backfill_2026_10_22_bak
  select id, title from items
  where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
    and id not in (select id from items_title_entity_backfill_2026_10_22_bak);

create table if not exists item_sources_title_entity_backfill_2026_10_22_bak as
  select item_id, source_id, title as old_title
  from item_sources
  where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
  with no data;
insert into item_sources_title_entity_backfill_2026_10_22_bak
  select item_id, source_id, title from item_sources
  where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
    and (item_id, source_id) not in (
      select item_id, source_id from item_sources_title_entity_backfill_2026_10_22_bak
    );

-- Same decode rules as entities.ts, ported to plpgsql for a one-time backfill.
-- One pass, left to right: "&amp;lt;" becomes the literal text "&lt;", never "<".
create or replace function pg_temp.decode_entities_2026_10_22(input text) returns text
language plpgsql as $$
declare
  result text := '';
  rest text := input;
  m text[];
  pos int;
  entity text;
  code bigint;
begin
  loop
    m := regexp_match(rest, '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);');
    if m is null then
      result := result || rest;
      exit;
    end if;
    entity := m[1];
    pos := position(('&' || entity || ';') in rest);
    result := result || substr(rest, 1, pos - 1);
    if left(entity, 1) = '#' then
      if lower(left(entity, 2)) = '#x' then
        code := ('x' || lpad(substr(entity, 3), 8, '0'))::bit(32)::bigint;
      else
        code := substr(entity, 2)::bigint;
      end if;
      if code > 0 and code <= 1114111 then
        result := result || chr(code::int);
      end if;
    else
      result := result || case lower(entity)
        when 'amp' then '&'
        when 'lt' then '<'
        when 'gt' then '>'
        when 'quot' then '"'
        when 'apos' then ''''
        when 'nbsp' then ' '
        else '&' || entity || ';'
      end;
    end if;
    rest := substr(rest, pos + length(entity) + 2);
  end loop;
  return result;
end;
$$;

update items
   set title = pg_temp.decode_entities_2026_10_22(title)
 where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);';

update item_sources
   set title = pg_temp.decode_entities_2026_10_22(title)
 where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);';

drop function pg_temp.decode_entities_2026_10_22(text);

commit;

-- Verify after applying:
--   select b.id, b.old_title, i.title as new_title
--     from items_title_entity_backfill_2026_10_22_bak b join items i on i.id = b.id
--    order by b.id;
--   select count(*) from items where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'; -- expect 0
--   select count(*) from item_sources where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'; -- expect 0
-- The two *_bak tables are left in place as a record of what changed; drop them
-- by hand once you've confirmed the result (they are not referenced anywhere).
