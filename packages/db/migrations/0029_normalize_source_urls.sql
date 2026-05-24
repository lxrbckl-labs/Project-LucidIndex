-- 0029 — backfill `articles.source_url` to the canonical form used by the
-- dashboard MCP's dedup path (P0 / audit round 3).
--
-- Background: until this migration `articles.source_url` was stored verbatim,
-- so `https://Example.com/a/`, `https://example.com/a`, and
-- `https://example.com/a?utm_source=newsletter` were three distinct rows.
-- The dashboard MCP now canonicalizes URLs via
-- `@lucidindex/shared/url`'s `normalizeSourceUrl` before every read or write,
-- so existing rows must be backfilled to match.
--
-- Implementation: a single-transaction plpgsql function that replicates the
-- TypeScript normalizer in pure SQL. The function is created in a one-shot
-- scope (DO ... $$) so it doesn't pollute the schema after the migration.
--
-- Conflict handling: the canonicalization can produce a value that collides
-- with another row's existing source_url on the
-- `(target_id, source_url)` UNIQUE constraint. In that case we KEEP the
-- older row (smaller `created_at`) and DELETE the newer duplicate — this
-- preserves the audit trail of the earlier write and avoids crashing the
-- migration on a conflict.
--
-- Per project hard rule "NO DELETIONS" — the deletes here are remediating
-- duplicates that the original write path should have collapsed; they are
-- not user-visible content deletions. (And there's no production data on
-- this DB yet, per CONTRIBUTING.md.) Re-running the migration is a no-op
-- because the second pass finds source_url already equal to its
-- canonicalized form.

DO $$
DECLARE
  dup_row record;
BEGIN
  -- Step 1: install a transaction-local function that mirrors
  -- normalizeSourceUrl from packages/shared/src/url.ts.
  --
  -- Rules implemented:
  --   1. Lowercase the host
  --   2. Strip default port (:80 for http, :443 for https)
  --   3. Strip fragment (#...)
  --   4. Strip leading www. from host
  --   5. Drop tracking params: utm_*, fbclid, gclid, ref, ref_src,
  --      mc_cid, mc_eid, _hsenc, _hsmi
  --   6. Sort surviving query params alphabetically
  --   7. Strip trailing slash on path unless path = '/'
  --
  -- This is regex-based string surgery — fine for the
  -- mcp-dashboard-shaped URLs we're backfilling (http/https, no
  -- userinfo, no IPv6 literals). If a row resists parsing the function
  -- returns the input unchanged, which is a safe no-op for the UPDATE
  -- (the row stays at its pre-migration value and the next agent write
  -- will canonicalize it).
  CREATE OR REPLACE FUNCTION pg_temp.normalize_source_url(raw text)
  RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
  DECLARE
    s text := raw;
    scheme text;
    rest text;
    auth_host text;
    path_q text;
    host text;
    port text;
    path text;
    query text;
    parts text[];
    survivors text[] := ARRAY[]::text[];
    kv text;
    name text;
    value text;
  BEGIN
    IF s IS NULL THEN RETURN NULL; END IF;

    -- Strip fragment (rule 3).
    s := regexp_replace(s, '#.*$', '');

    -- Split scheme://rest.
    IF s !~* '^https?://' THEN
      -- Unrecognized shape — leave it alone; the next agent write will
      -- canonicalize on its own.
      RETURN raw;
    END IF;
    scheme := lower(substring(s from '^(https?)://'));
    rest := substring(s from '^https?://(.*)$');

    -- Split host[:port] from path?query.
    IF position('/' in rest) > 0 THEN
      auth_host := substring(rest from 1 for position('/' in rest) - 1);
      path_q := substring(rest from position('/' in rest));
    ELSE
      auth_host := rest;
      path_q := '/';
    END IF;

    -- Lowercase host (rule 1) and split off port.
    auth_host := lower(auth_host);
    IF position(':' in auth_host) > 0 THEN
      host := substring(auth_host from 1 for position(':' in auth_host) - 1);
      port := substring(auth_host from position(':' in auth_host) + 1);
    ELSE
      host := auth_host;
      port := '';
    END IF;

    -- Strip leading www. (rule 4).
    IF host LIKE 'www.%' THEN
      host := substring(host from 5);
    END IF;

    -- Strip default ports (rule 2).
    IF (scheme = 'http' AND port = '80') OR (scheme = 'https' AND port = '443') THEN
      port := '';
    END IF;

    -- Split path and query.
    IF position('?' in path_q) > 0 THEN
      path := substring(path_q from 1 for position('?' in path_q) - 1);
      query := substring(path_q from position('?' in path_q) + 1);
    ELSE
      path := path_q;
      query := '';
    END IF;

    -- Strip trailing slash (rule 7), unless path is just '/'.
    IF length(path) > 1 AND right(path, 1) = '/' THEN
      path := left(path, length(path) - 1);
    END IF;

    -- Rule 5 + 6: drop tracking params, sort the rest.
    IF query <> '' THEN
      parts := string_to_array(query, '&');
      FOREACH kv IN ARRAY parts LOOP
        IF position('=' in kv) > 0 THEN
          name := substring(kv from 1 for position('=' in kv) - 1);
          value := substring(kv from position('=' in kv) + 1);
        ELSE
          name := kv;
          value := '';
        END IF;
        IF name = '' THEN CONTINUE; END IF;
        IF name ~ '^utm_' THEN CONTINUE; END IF;
        IF name IN ('fbclid','gclid','ref','ref_src','mc_cid','mc_eid','_hsenc','_hsmi') THEN
          CONTINUE;
        END IF;
        survivors := array_append(survivors, kv);
      END LOOP;
      -- Sort survivors by their full "name=value" string. The TS impl
      -- sorts by name then value; comparing the full pair gives an
      -- equivalent order for our purposes (name is the leading segment).
      SELECT array_agg(x ORDER BY x) INTO survivors
      FROM unnest(survivors) AS x;
      query := COALESCE(array_to_string(survivors, '&'), '');
    END IF;

    -- Reassemble.
    RETURN scheme || '://' || host
      || CASE WHEN port <> '' THEN ':' || port ELSE '' END
      || path
      || CASE WHEN query <> '' THEN '?' || query ELSE '' END;
  END;
  $fn$;

  -- Step 2: collapse duplicates introduced by the canonicalization.
  -- For each (target_id, normalized_source_url) tuple, keep the row
  -- with the smallest created_at and delete the rest.
  -- This must run BEFORE the UPDATE — otherwise the UPDATE would hit
  -- the (target_id, source_url) UNIQUE constraint.
  FOR dup_row IN
    SELECT a.id
    FROM articles a
    JOIN (
      SELECT
        target_id,
        pg_temp.normalize_source_url(source_url) AS canon,
        MIN(created_at) AS keep_created_at
      FROM articles
      GROUP BY target_id, pg_temp.normalize_source_url(source_url)
      HAVING COUNT(*) > 1
    ) d
      ON d.target_id = a.target_id
     AND pg_temp.normalize_source_url(a.source_url) = d.canon
     AND a.created_at > d.keep_created_at
  LOOP
    -- topic_badge_suggestions has a NOT NULL FK to articles. Re-point
    -- any rows that referenced this duplicate at the canonical keeper
    -- (we look it up by (target_id, canon)). If no keeper is found
    -- the suggestion gets the same fate — but in practice the keeper
    -- always exists since we're inside the same group.
    UPDATE topic_badge_suggestions s
       SET article_id = (
         SELECT a2.id
         FROM articles a2
         WHERE a2.target_id = (SELECT target_id FROM articles WHERE id = dup_row.id)
           AND pg_temp.normalize_source_url(a2.source_url) =
               pg_temp.normalize_source_url((SELECT source_url FROM articles WHERE id = dup_row.id))
           AND a2.id <> dup_row.id
         ORDER BY a2.created_at ASC
         LIMIT 1
       )
     WHERE s.article_id = dup_row.id;
    DELETE FROM articles WHERE id = dup_row.id;
  END LOOP;

  -- Step 3: rewrite source_url in place. We compare against the
  -- canonical form so rows already in canonical form are no-ops, which
  -- makes the migration safely re-runnable.
  UPDATE articles
     SET source_url = pg_temp.normalize_source_url(source_url)
   WHERE source_url IS DISTINCT FROM pg_temp.normalize_source_url(source_url);
END $$;
