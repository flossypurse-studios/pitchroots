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
-- Backs up the exact rows it is about to change (key + old and new value) before
-- touching them, decodes in place with the same semantics as
-- supabase/functions/poll/entities.mjs (decimal + hex numeric references, the
-- six XML/HTML named ones that actually leak into feeds, anything else left
-- exactly as written), then drops the helper function — nothing permanent is
-- added to the schema. Idempotent: a second run
-- changes nothing (see the note above the backup tables).
begin;

-- Same decode rules as entities.mjs, ported to plpgsql for a one-time
-- backfill. One pass, left to right: "&amp;lt;" becomes the literal text "&lt;",
-- never "<". Out-of-range numeric references decode to nothing, as in the JS;
-- a surrogate code point (which chr() rejects) becomes U+FFFD, which is what the
-- JS decoder's lone surrogate turns into on its way into Postgres.
create or replace function pg_temp.decode_entities_2026_10_22(input text) returns text
language plpgsql as $$
declare
  result text := '';
  rest text := input;
  m text[];
  pos int;
  entity text;
  digits text;
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
        digits := ltrim(substr(entity, 3), '0');
        code := case when digits = '' then 0
                     when length(digits) > 6 then -1
                     else ('x' || lpad(digits, 8, '0'))::bit(32)::bigint end;
      else
        digits := ltrim(substr(entity, 2), '0');
        code := case when digits = '' then 0
                     when length(digits) > 7 then -1
                     else digits::bigint end;
      end if;
      if code between 55296 and 57343 then
        result := result || chr(65533);
      elsif code > 0 and code <= 1114111 then
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

-- The backup IS the change list: only rows whose decoded title differs from the
-- stored one go in, each with its old and new value, and the UPDATE applies
-- exactly those rows and only while the title still equals the backed-up old
-- value. A row with no decodable reference ("Q&A; session") is never backed up
-- or touched. Idempotent: on a re-run every changed row is already in the backup
-- (so "&amp;lt;" → "&lt;" is never decoded a second time into "<") and no
-- current title equals its old value, so both statements do nothing.
create table if not exists items_title_entity_backfill_2026_10_22_bak (
  id bigint primary key,
  old_title text not null,
  new_title text not null
);
insert into items_title_entity_backfill_2026_10_22_bak (id, old_title, new_title)
  select id, title, pg_temp.decode_entities_2026_10_22(title) from items
  where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
    and pg_temp.decode_entities_2026_10_22(title) <> title
on conflict (id) do nothing;

create table if not exists item_sources_title_entity_backfill_2026_10_22_bak (
  item_id bigint not null,
  source_id int not null,
  old_title text not null,
  new_title text not null,
  primary key (item_id, source_id)
);
insert into item_sources_title_entity_backfill_2026_10_22_bak (item_id, source_id, old_title, new_title)
  select item_id, source_id, title, pg_temp.decode_entities_2026_10_22(title) from item_sources
  where title ~ '&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);'
    and pg_temp.decode_entities_2026_10_22(title) <> title
on conflict (item_id, source_id) do nothing;

update items i
   set title = b.new_title
  from items_title_entity_backfill_2026_10_22_bak b
 where i.id = b.id
   and i.title = b.old_title;

update item_sources s
   set title = b.new_title
  from item_sources_title_entity_backfill_2026_10_22_bak b
 where s.item_id = b.item_id
   and s.source_id = b.source_id
   and s.title = b.old_title;

drop function pg_temp.decode_entities_2026_10_22(text);

commit;

-- Verify after applying (each backed-up row should now read new_title):
--   select b.id, b.old_title, i.title from items_title_entity_backfill_2026_10_22_bak b
--     join items i on i.id = b.id where i.title <> b.new_title;          -- expect 0 rows
--   select b.item_id, b.source_id, s.title from item_sources_title_entity_backfill_2026_10_22_bak b
--     join item_sources s using (item_id, source_id) where s.title <> b.new_title; -- expect 0 rows
-- The two *_bak tables are left in place as a record of what changed; drop them
-- by hand once you've confirmed the result (they are not referenced anywhere).
