# Web3 source-plan production rollout

This is a one-user, one-course recovery procedure for replacing legacy Web3
topics with the reviewed source-grounded course. It is not a general reset or
backfill mechanism.

## Hard gates

Stop immediately unless all of these are true:

- the source-grounded code, migration, manifest, and curated Web3 JSON have
  passed review and are deployed;
- the deployed revision and container payload match the reviewed revision;
- all 360 Web3 pattern topics pass structural and live URL validation;
- a timestamped custom-format PostgreSQL backup exists and pg_restore can list
  it;
- the exact email resolves to one user;
- the API is stopped before the transaction so the target rows cannot change;
- every count and cross-domain guard below matches expectations.

Never use a title-only destructive predicate. Every mutation below is scoped
through the exact target user and Topic.domain = 'Web3'. Never run prisma
migrate reset, docker compose down -v, TRUNCATE, or an unqualified DELETE.

Production deletion is an operator action. This document deliberately leaves
the transaction open: the operator must enter COMMIT as a separate command
after reviewing the post-delete proof. Enter ROLLBACK on any uncertainty.

## 1. Deploy and prove the payload

Run from the production checkout. Record the immutable revision in the rollout
record at the end of this document.

~~~bash
git status --short
git rev-parse HEAD
corepack yarn install --immutable
yarn web3:content:test
yarn web3:content:validate
node scripts/validate-web3-content.mjs --check-urls
yarn build
yarn test
yarn lint
yarn format:check
~~~

The working tree must be clean and every command must exit zero. Build that
exact checkout, start only Postgres, apply migrations with a one-off API
container, and only then start the API and web containers:

~~~bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production stop api web
docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
until docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  sh -lc 'exec pg_isready --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'; do sleep 2; done
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
  ../../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
  ../../node_modules/.bin/prisma migrate status --schema prisma/schema.prisma
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api web
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api
~~~

Compare host and runtime-container hashes. A diff is a stop condition.

~~~bash
find content/web3 -type f -name '*.json' -print0 \
  | sort -z | xargs -0 sha256sum > /tmp/web3-host.sha256
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api \
  sh -lc 'cd /workspace && find content/web3 -type f -name "*.json" -print0 | sort -z | xargs -0 sha256sum' \
  > /tmp/web3-container.sha256
diff -u /tmp/web3-host.sha256 /tmp/web3-container.sha256
~~~

Confirm the compiled manifest names the same 24 files in dependency order:

~~~bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api \
  node -e 'const {COURSE_MANIFEST}=require("./dist/src/courses/course-manifest"); const c=COURSE_MANIFEST.find(x=>x.id==="web3"); if(!c) process.exit(1); console.log(c.files.join("\n"))'
~~~

Do not continue if the revision, hashes, manifest, migration status, or content
gate is uncertain.

## 2. Take and inspect a backup

Stop the API before taking the backup so its archive covers the exact
application-visible state used by the reset. The backup is created on the host
with restrictive permissions. Copy it off-host before deletion and keep the
API stopped through the transaction.

~~~bash
umask 077
mkdir -p backups
BACKUP="backups/terrain-before-web3-source-plan-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f docker-compose.prod.yml --env-file .env.production stop api
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  sh -lc 'exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$BACKUP"
test -s "$BACKUP"
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  pg_restore --list < "$BACKUP" > "$BACKUP.list"
test -s "$BACKUP.list"
sha256sum "$BACKUP" "$BACKUP.list"
~~~

Record the absolute backup path, byte size, SHA-256, and the first and last ten
lines of the list. Listing proves that PostgreSQL can parse the custom archive;
it does not replace a restore drill.

## 3. Resolve the target and capture read-only counts

Confirm the API remains stopped to prevent concurrent application writes. Set
the exact email without putting a password in shell history, then open one
interactive psql session. Keep this session open through the transaction.

~~~bash
docker compose -f docker-compose.prod.yml --env-file .env.production stop api
export TARGET_EMAIL='replace-with-the-exact-account-email'
docker compose -f docker-compose.prod.yml --env-file .env.production exec -it \
  -e TARGET_EMAIL="$TARGET_EMAIL" db sh -lc \
  'exec psql -X --set=ON_ERROR_STOP=1 --set=target_email="$TARGET_EMAIL" --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
~~~

Paste the following read-only block. It creates session-local temporary
snapshots; it changes no durable rows.

~~~sql
\pset pager off
\timing on

SELECT count(*) = 1 AS exactly_one, count(*) AS matches
FROM "User"
WHERE "email" = :'target_email'
\gset target_

\if :target_exactly_one
  \echo 'Target email resolved to exactly one user.'
\else
  \echo 'STOP: target email did not resolve to exactly one user.'
  \quit
\endif

CREATE TEMP TABLE rollout_user ON COMMIT PRESERVE ROWS AS
SELECT "id", "email"
FROM "User"
WHERE "email" = :'target_email';

CREATE UNIQUE INDEX rollout_user_id_key ON rollout_user ("id");

CREATE TEMP TABLE rollout_expected_topics ON COMMIT PRESERVE ROWS AS
SELECT t."id"
FROM "Topic" t
JOIN rollout_user u ON u."id" = t."userId"
WHERE t."domain" = 'Web3';

CREATE UNIQUE INDEX rollout_expected_topics_id_key
ON rollout_expected_topics ("id");

CREATE TEMP TABLE rollout_expected_sessions ON COMMIT PRESERVE ROWS AS
SELECT DISTINCT s."id"
FROM "SessionExport" s
JOIN rollout_user u ON u."id" = s."userId"
WHERE s."domain" = 'Web3'
   OR EXISTS (
        SELECT 1
        FROM rollout_expected_topics t
        WHERE t."id" = s."focusTopicId"
      )
   OR EXISTS (
        SELECT 1
        FROM unnest(coalesce(s."newTopicsCreated", ARRAY[]::text[])) created("id")
        JOIN rollout_expected_topics t ON t."id" = created."id"
      )
   OR EXISTS (
        SELECT 1
        FROM "SourceEvidence" se
        JOIN rollout_expected_topics t ON t."id" = se."topicId"
        WHERE se."sessionExportId" = s."id"
          AND se."userId" = u."id"
      );

CREATE UNIQUE INDEX rollout_expected_sessions_id_key
ON rollout_expected_sessions ("id");

CREATE TEMP TABLE rollout_expected_counts ON COMMIT PRESERVE ROWS AS
SELECT
  (SELECT count(*) FROM rollout_expected_topics) AS web3_topics,
  (SELECT count(*) FROM "Prompt" p
   JOIN rollout_expected_topics t ON t."id" = p."topicId") AS prompts,
  (SELECT count(*) FROM "Review" r
   JOIN rollout_expected_topics t ON t."id" = r."topicId"
   JOIN rollout_user u ON u."id" = r."userId") AS reviews,
  (SELECT count(*) FROM "ApplicationEvent" a
   JOIN rollout_expected_topics t ON t."id" = a."topicId"
   JOIN rollout_user u ON u."id" = a."userId") AS application_events,
  (SELECT count(*) FROM "SourceEvidence" se
   JOIN rollout_expected_topics t ON t."id" = se."topicId"
   JOIN rollout_user u ON u."id" = se."userId") AS source_evidence,
  (SELECT count(*) FROM "Prerequisite" p
   WHERE p."topicId" IN (SELECT "id" FROM rollout_expected_topics)
      OR p."prerequisiteId" IN (SELECT "id" FROM rollout_expected_topics))
    AS prerequisite_edges,
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_expected_topics x ON x."id" = t."id"
   WHERE nullif(btrim(t."summary"), '') IS NOT NULL) AS topics_with_summary,
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_expected_topics x ON x."id" = t."id"
   WHERE nullif(btrim(t."noteRef"), '') IS NOT NULL) AS topics_with_note_ref,
  (SELECT count(*) FROM rollout_expected_sessions) AS session_references,
  (SELECT count(*) FROM "CourseImport" c
   JOIN rollout_user u ON u."id" = c."userId"
   WHERE c."courseId" = 'web3') AS course_markers;

TABLE rollout_user;
TABLE rollout_expected_counts;

SELECT
  count(*) FILTER (WHERE child_is_target <> parent_is_target)
    AS cross_domain_parent_edges
FROM (
  SELECT
    EXISTS (SELECT 1 FROM rollout_expected_topics x WHERE x."id" = child."id")
      AS child_is_target,
    EXISTS (SELECT 1 FROM rollout_expected_topics x WHERE x."id" = child."parentId")
      AS parent_is_target
  FROM "Topic" child
  WHERE child."parentId" IS NOT NULL
) parent_edges;

SELECT count(*) AS cross_domain_prerequisite_edges
FROM "Prerequisite" p
WHERE
  EXISTS (SELECT 1 FROM rollout_expected_topics x WHERE x."id" = p."topicId")
  <>
  EXISTS (SELECT 1 FROM rollout_expected_topics x WHERE x."id" = p."prerequisiteId");

SELECT count(*) AS mixed_session_references
FROM "SessionExport" s
JOIN rollout_expected_sessions rs ON rs."id" = s."id"
WHERE (s."domain" IS NOT NULL AND s."domain" <> 'Web3')
   OR (s."focusTopicId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM rollout_expected_topics t WHERE t."id" = s."focusTopicId"
      ))
   OR EXISTS (
        SELECT 1
        FROM unnest(coalesce(s."newTopicsCreated", ARRAY[]::text[])) created("id")
        WHERE NOT EXISTS (
          SELECT 1 FROM rollout_expected_topics t WHERE t."id" = created."id"
        )
      )
   OR EXISTS (
        SELECT 1
        FROM "SourceEvidence" se
        WHERE se."sessionExportId" = s."id"
          AND NOT EXISTS (
            SELECT 1 FROM rollout_expected_topics t WHERE t."id" = se."topicId"
          )
      );

SELECT count(*) AS inconsistent_user_ownership
FROM (
  SELECT r."id"
  FROM "Review" r
  JOIN rollout_expected_topics t ON t."id" = r."topicId"
  WHERE r."userId" <> (SELECT "id" FROM rollout_user)
  UNION ALL
  SELECT a."id"
  FROM "ApplicationEvent" a
  JOIN rollout_expected_topics t ON t."id" = a."topicId"
  WHERE a."userId" <> (SELECT "id" FROM rollout_user)
  UNION ALL
  SELECT se."id"
  FROM "SourceEvidence" se
  WHERE (
      se."topicId" IN (SELECT "id" FROM rollout_expected_topics)
      OR se."sessionExportId" IN (SELECT "id" FROM rollout_expected_sessions)
    )
    AND (
      se."userId" <> (SELECT "id" FROM rollout_user)
      OR se."sessionExportId" NOT IN (SELECT "id" FROM rollout_expected_sessions)
    )
) inconsistent;
~~~

Record every count. The three cross-domain/mixed-session guards and the
ownership guard must all be zero. If any is not, quit and investigate; do not
broaden the delete.

## 4. Lock, recompute, and run the reversible transaction

Still in the same psql session, snapshot the data that must survive:

~~~sql
CREATE TEMP TABLE rollout_expected_preserved ON COMMIT PRESERVE ROWS AS
SELECT
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_user u ON u."id" = t."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_topics,
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_user u ON u."id" = t."userId"
   WHERE t."domain" = 'DSA') AS target_dsa_topics,
  (SELECT count(*) FROM "Prompt" p
   JOIN "Topic" t ON t."id" = p."topicId"
   JOIN rollout_user u ON u."id" = t."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_prompts,
  (SELECT count(*) FROM "Review" r
   JOIN "Topic" t ON t."id" = r."topicId"
   JOIN rollout_user u ON u."id" = r."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_reviews,
  (SELECT count(*) FROM "ApplicationEvent" a
   JOIN "Topic" t ON t."id" = a."topicId"
   JOIN rollout_user u ON u."id" = a."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_application_events,
  (SELECT count(*) FROM "SourceEvidence" se
   JOIN "Topic" t ON t."id" = se."topicId"
   JOIN rollout_user u ON u."id" = se."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_source_evidence,
  (SELECT count(*) FROM "Prerequisite" p
   JOIN "Topic" dependent ON dependent."id" = p."topicId"
   JOIN rollout_user u ON u."id" = dependent."userId"
   WHERE p."topicId" NOT IN (SELECT "id" FROM rollout_expected_topics)
     AND p."prerequisiteId" NOT IN (SELECT "id" FROM rollout_expected_topics))
    AS target_non_web3_prerequisite_edges,
  (SELECT count(*) FROM "SessionExport" s
   JOIN rollout_user u ON u."id" = s."userId"
   WHERE s."id" NOT IN (SELECT "id" FROM rollout_expected_sessions))
    AS target_other_sessions,
  (SELECT count(*) FROM "CourseImport" c
   JOIN rollout_user u ON u."id" = c."userId"
   WHERE c."courseId" <> 'web3') AS target_other_course_markers,
  (SELECT count(*) FROM "Topic" t
   WHERE t."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_topics,
  (SELECT count(*) FROM "Prompt" p
   JOIN "Topic" t ON t."id" = p."topicId"
   WHERE t."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_prompts,
  (SELECT count(*) FROM "Review" r
   WHERE r."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_reviews,
  (SELECT count(*) FROM "ApplicationEvent" a
   WHERE a."userId" NOT IN (SELECT "id" FROM rollout_user))
    AS other_user_application_events,
  (SELECT count(*) FROM "SourceEvidence" se
   WHERE se."userId" NOT IN (SELECT "id" FROM rollout_user))
    AS other_user_source_evidence,
  (SELECT count(*) FROM "SessionExport" s
   WHERE s."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_sessions,
  (SELECT count(*) FROM "CourseImport" c
   WHERE c."userId" NOT IN (SELECT "id" FROM rollout_user))
    AS other_user_course_markers;

TABLE rollout_expected_preserved;
~~~

Begin the transaction, lock the exact user, rebuild the target sets, and compare
them with the read-only snapshots:

~~~sql
BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE
  "User", "Topic", "Prompt", "Review", "ApplicationEvent",
  "SourceEvidence", "SessionExport", "Prerequisite", "CourseImport"
IN SHARE ROW EXCLUSIVE MODE;

SELECT db_user."id"
FROM "User" db_user
JOIN rollout_user target ON target."id" = db_user."id"
FOR UPDATE;

CREATE TEMP TABLE rollout_locked_topics ON COMMIT DROP AS
SELECT t."id"
FROM "Topic" t
JOIN rollout_user u ON u."id" = t."userId"
WHERE t."domain" = 'Web3';

CREATE UNIQUE INDEX rollout_locked_topics_id_key
ON rollout_locked_topics ("id");

CREATE TEMP TABLE rollout_locked_sessions ON COMMIT DROP AS
SELECT DISTINCT s."id"
FROM "SessionExport" s
JOIN rollout_user u ON u."id" = s."userId"
WHERE s."domain" = 'Web3'
   OR EXISTS (
        SELECT 1 FROM rollout_locked_topics t
        WHERE t."id" = s."focusTopicId"
      )
   OR EXISTS (
        SELECT 1
        FROM unnest(coalesce(s."newTopicsCreated", ARRAY[]::text[])) created("id")
        JOIN rollout_locked_topics t ON t."id" = created."id"
      )
   OR EXISTS (
        SELECT 1
        FROM "SourceEvidence" se
        JOIN rollout_locked_topics t ON t."id" = se."topicId"
        WHERE se."sessionExportId" = s."id"
          AND se."userId" = u."id"
      );

CREATE UNIQUE INDEX rollout_locked_sessions_id_key
ON rollout_locked_sessions ("id");

CREATE TEMP TABLE rollout_locked_counts ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM rollout_locked_topics) AS web3_topics,
  (SELECT count(*) FROM "Prompt" p
   JOIN rollout_locked_topics t ON t."id" = p."topicId") AS prompts,
  (SELECT count(*) FROM "Review" r
   JOIN rollout_locked_topics t ON t."id" = r."topicId"
   JOIN rollout_user u ON u."id" = r."userId") AS reviews,
  (SELECT count(*) FROM "ApplicationEvent" a
   JOIN rollout_locked_topics t ON t."id" = a."topicId"
   JOIN rollout_user u ON u."id" = a."userId") AS application_events,
  (SELECT count(*) FROM "SourceEvidence" se
   JOIN rollout_locked_topics t ON t."id" = se."topicId"
   JOIN rollout_user u ON u."id" = se."userId") AS source_evidence,
  (SELECT count(*) FROM "Prerequisite" p
   WHERE p."topicId" IN (SELECT "id" FROM rollout_locked_topics)
      OR p."prerequisiteId" IN (SELECT "id" FROM rollout_locked_topics))
    AS prerequisite_edges,
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_locked_topics x ON x."id" = t."id"
   WHERE nullif(btrim(t."summary"), '') IS NOT NULL) AS topics_with_summary,
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_locked_topics x ON x."id" = t."id"
   WHERE nullif(btrim(t."noteRef"), '') IS NOT NULL) AS topics_with_note_ref,
  (SELECT count(*) FROM rollout_locked_sessions) AS session_references,
  (SELECT count(*) FROM "CourseImport" c
   JOIN rollout_user u ON u."id" = c."userId"
   WHERE c."courseId" = 'web3') AS course_markers;

TABLE rollout_locked_counts;

SELECT
  to_jsonb(expected_counts) = to_jsonb(locked_counts)
    AS counts_unchanged,
  NOT EXISTS (
    (SELECT "id" FROM rollout_expected_topics
     EXCEPT SELECT "id" FROM rollout_locked_topics)
    UNION ALL
    (SELECT "id" FROM rollout_locked_topics
     EXCEPT SELECT "id" FROM rollout_expected_topics)
  ) AS topic_ids_unchanged,
  NOT EXISTS (
    (SELECT "id" FROM rollout_expected_sessions
     EXCEPT SELECT "id" FROM rollout_locked_sessions)
    UNION ALL
    (SELECT "id" FROM rollout_locked_sessions
     EXCEPT SELECT "id" FROM rollout_expected_sessions)
  ) AS session_ids_unchanged
FROM rollout_expected_counts expected_counts
CROSS JOIN rollout_locked_counts locked_counts;

SELECT (
  to_jsonb(expected_counts) = to_jsonb(locked_counts)
  AND NOT EXISTS (
    (SELECT "id" FROM rollout_expected_topics
     EXCEPT SELECT "id" FROM rollout_locked_topics)
    UNION ALL
    (SELECT "id" FROM rollout_locked_topics
     EXCEPT SELECT "id" FROM rollout_expected_topics)
  )
  AND NOT EXISTS (
    (SELECT "id" FROM rollout_expected_sessions
     EXCEPT SELECT "id" FROM rollout_locked_sessions)
    UNION ALL
    (SELECT "id" FROM rollout_locked_sessions
     EXCEPT SELECT "id" FROM rollout_expected_sessions)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Topic" child
    WHERE child."parentId" IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM rollout_locked_topics x WHERE x."id" = child."id")
        <>
        EXISTS (SELECT 1 FROM rollout_locked_topics x WHERE x."id" = child."parentId")
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "Prerequisite" p
    WHERE
      EXISTS (SELECT 1 FROM rollout_locked_topics x WHERE x."id" = p."topicId")
      <>
      EXISTS (SELECT 1 FROM rollout_locked_topics x WHERE x."id" = p."prerequisiteId")
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "SessionExport" s
    JOIN rollout_locked_sessions rs ON rs."id" = s."id"
    WHERE (s."domain" IS NOT NULL AND s."domain" <> 'Web3')
       OR (s."focusTopicId" IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM rollout_locked_topics t WHERE t."id" = s."focusTopicId"
          ))
       OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(s."newTopicsCreated", ARRAY[]::text[])) created("id")
            WHERE NOT EXISTS (
              SELECT 1 FROM rollout_locked_topics t WHERE t."id" = created."id"
            )
          )
       OR EXISTS (
            SELECT 1
            FROM "SourceEvidence" se
            WHERE se."sessionExportId" = s."id"
              AND NOT EXISTS (
                SELECT 1 FROM rollout_locked_topics t WHERE t."id" = se."topicId"
              )
          )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT r."id"
      FROM "Review" r
      JOIN rollout_locked_topics t ON t."id" = r."topicId"
      WHERE r."userId" <> (SELECT "id" FROM rollout_user)
      UNION ALL
      SELECT a."id"
      FROM "ApplicationEvent" a
      JOIN rollout_locked_topics t ON t."id" = a."topicId"
      WHERE a."userId" <> (SELECT "id" FROM rollout_user)
      UNION ALL
      SELECT se."id"
      FROM "SourceEvidence" se
      WHERE (
          se."topicId" IN (SELECT "id" FROM rollout_locked_topics)
          OR se."sessionExportId" IN (SELECT "id" FROM rollout_locked_sessions)
        )
        AND (
          se."userId" <> (SELECT "id" FROM rollout_user)
          OR se."sessionExportId" NOT IN (SELECT "id" FROM rollout_locked_sessions)
        )
    ) inconsistent
  )
) AS safe_to_delete
FROM rollout_expected_counts expected_counts
CROSS JOIN rollout_locked_counts locked_counts
\gset locked_

\if :locked_safe_to_delete
  \echo 'Locked targets and counts match; cross-domain and ownership guards are clean.'
\else
  \echo 'STOP: locked state differs or a safety guard failed. Rolling back.'
  ROLLBACK;
  \quit
\endif
~~~

The following deletes only the locked IDs, with the exact user predicate kept
on every table that has userId:

~~~sql
WITH deleted AS (
  DELETE FROM "Review" r
  USING rollout_user u
  WHERE r."userId" = u."id"
    AND r."topicId" IN (SELECT "id" FROM rollout_locked_topics)
  RETURNING r."id"
)
SELECT 'Review' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "ApplicationEvent" a
  USING rollout_user u
  WHERE a."userId" = u."id"
    AND a."topicId" IN (SELECT "id" FROM rollout_locked_topics)
  RETURNING a."id"
)
SELECT 'ApplicationEvent' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "SourceEvidence" se
  USING rollout_user u
  WHERE se."userId" = u."id"
    AND (
      se."topicId" IN (SELECT "id" FROM rollout_locked_topics)
      OR se."sessionExportId" IN (SELECT "id" FROM rollout_locked_sessions)
    )
  RETURNING se."id"
)
SELECT 'SourceEvidence' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "SessionExport" s
  USING rollout_user u
  WHERE s."userId" = u."id"
    AND s."id" IN (SELECT "id" FROM rollout_locked_sessions)
  RETURNING s."id"
)
SELECT 'SessionExport' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "Prompt" p
  WHERE p."topicId" IN (SELECT "id" FROM rollout_locked_topics)
  RETURNING p."id"
)
SELECT 'Prompt' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "Prerequisite" p
  WHERE p."topicId" IN (SELECT "id" FROM rollout_locked_topics)
     OR p."prerequisiteId" IN (SELECT "id" FROM rollout_locked_topics)
  RETURNING p."topicId", p."prerequisiteId"
)
SELECT 'Prerequisite' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "Topic" t
  USING rollout_user u
  WHERE t."userId" = u."id"
    AND t."domain" = 'Web3'
    AND t."id" IN (SELECT "id" FROM rollout_locked_topics)
  RETURNING t."id"
)
SELECT 'Topic' AS deleted_table, count(*) AS deleted_rows FROM deleted;

WITH deleted AS (
  DELETE FROM "CourseImport" c
  USING rollout_user u
  WHERE c."userId" = u."id"
    AND c."courseId" = 'web3'
  RETURNING c."id"
)
SELECT 'CourseImport' AS deleted_table, count(*) AS deleted_rows FROM deleted;
~~~

Build and compare the post-delete proof while the transaction is still open:

~~~sql
CREATE TEMP TABLE rollout_actual_preserved ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_user u ON u."id" = t."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_topics,
  (SELECT count(*) FROM "Topic" t
   JOIN rollout_user u ON u."id" = t."userId"
   WHERE t."domain" = 'DSA') AS target_dsa_topics,
  (SELECT count(*) FROM "Prompt" p
   JOIN "Topic" t ON t."id" = p."topicId"
   JOIN rollout_user u ON u."id" = t."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_prompts,
  (SELECT count(*) FROM "Review" r
   JOIN "Topic" t ON t."id" = r."topicId"
   JOIN rollout_user u ON u."id" = r."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_reviews,
  (SELECT count(*) FROM "ApplicationEvent" a
   JOIN "Topic" t ON t."id" = a."topicId"
   JOIN rollout_user u ON u."id" = a."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_application_events,
  (SELECT count(*) FROM "SourceEvidence" se
   JOIN "Topic" t ON t."id" = se."topicId"
   JOIN rollout_user u ON u."id" = se."userId"
   WHERE t."domain" <> 'Web3') AS target_non_web3_source_evidence,
  (SELECT count(*) FROM "Prerequisite" p
   JOIN "Topic" dependent ON dependent."id" = p."topicId"
   JOIN rollout_user u ON u."id" = dependent."userId"
   WHERE p."topicId" NOT IN (SELECT "id" FROM rollout_locked_topics)
     AND p."prerequisiteId" NOT IN (SELECT "id" FROM rollout_locked_topics))
    AS target_non_web3_prerequisite_edges,
  (SELECT count(*) FROM "SessionExport" s
   JOIN rollout_user u ON u."id" = s."userId"
   WHERE s."id" NOT IN (SELECT "id" FROM rollout_locked_sessions))
    AS target_other_sessions,
  (SELECT count(*) FROM "CourseImport" c
   JOIN rollout_user u ON u."id" = c."userId"
   WHERE c."courseId" <> 'web3') AS target_other_course_markers,
  (SELECT count(*) FROM "Topic" t
   WHERE t."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_topics,
  (SELECT count(*) FROM "Prompt" p
   JOIN "Topic" t ON t."id" = p."topicId"
   WHERE t."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_prompts,
  (SELECT count(*) FROM "Review" r
   WHERE r."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_reviews,
  (SELECT count(*) FROM "ApplicationEvent" a
   WHERE a."userId" NOT IN (SELECT "id" FROM rollout_user))
    AS other_user_application_events,
  (SELECT count(*) FROM "SourceEvidence" se
   WHERE se."userId" NOT IN (SELECT "id" FROM rollout_user))
    AS other_user_source_evidence,
  (SELECT count(*) FROM "SessionExport" s
   WHERE s."userId" NOT IN (SELECT "id" FROM rollout_user)) AS other_user_sessions,
  (SELECT count(*) FROM "CourseImport" c
   WHERE c."userId" NOT IN (SELECT "id" FROM rollout_user))
    AS other_user_course_markers;

TABLE rollout_actual_preserved;

SELECT
  NOT EXISTS (
    SELECT 1 FROM "Topic" t
    JOIN rollout_user u ON u."id" = t."userId"
    WHERE t."domain" = 'Web3'
  ) AS web3_topics_zero,
  NOT EXISTS (
    SELECT 1 FROM "Review" r
    JOIN rollout_locked_topics t ON t."id" = r."topicId"
  ) AS web3_reviews_zero,
  NOT EXISTS (
    SELECT 1 FROM "ApplicationEvent" a
    JOIN rollout_locked_topics t ON t."id" = a."topicId"
  ) AS web3_application_events_zero,
  NOT EXISTS (
    SELECT 1 FROM "SourceEvidence" se
    WHERE se."topicId" IN (SELECT "id" FROM rollout_locked_topics)
       OR se."sessionExportId" IN (SELECT "id" FROM rollout_locked_sessions)
  ) AS web3_source_evidence_zero,
  NOT EXISTS (
    SELECT 1 FROM "Prompt" p
    JOIN rollout_locked_topics t ON t."id" = p."topicId"
  ) AS web3_prompts_zero,
  NOT EXISTS (
    SELECT 1 FROM "Prerequisite" p
    WHERE p."topicId" IN (SELECT "id" FROM rollout_locked_topics)
       OR p."prerequisiteId" IN (SELECT "id" FROM rollout_locked_topics)
  ) AS web3_prerequisites_zero,
  NOT EXISTS (
    SELECT 1 FROM "SessionExport" s
    JOIN rollout_locked_sessions rs ON rs."id" = s."id"
  ) AS web3_sessions_zero,
  NOT EXISTS (
    SELECT 1 FROM "CourseImport" c
    JOIN rollout_user u ON u."id" = c."userId"
    WHERE c."courseId" = 'web3'
  ) AS web3_course_marker_zero,
  to_jsonb(expected) = to_jsonb(actual) AS preserved_counts_equal
FROM rollout_expected_preserved expected
CROSS JOIN rollout_actual_preserved actual;

SELECT (
  NOT EXISTS (
    SELECT 1 FROM "Topic" t
    JOIN rollout_user u ON u."id" = t."userId"
    WHERE t."domain" = 'Web3'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Review" r
    JOIN rollout_locked_topics t ON t."id" = r."topicId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ApplicationEvent" a
    JOIN rollout_locked_topics t ON t."id" = a."topicId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SourceEvidence" se
    WHERE se."topicId" IN (SELECT "id" FROM rollout_locked_topics)
       OR se."sessionExportId" IN (SELECT "id" FROM rollout_locked_sessions)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Prompt" p
    JOIN rollout_locked_topics t ON t."id" = p."topicId"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Prerequisite" p
    WHERE p."topicId" IN (SELECT "id" FROM rollout_locked_topics)
       OR p."prerequisiteId" IN (SELECT "id" FROM rollout_locked_topics)
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SessionExport" s
    JOIN rollout_locked_sessions rs ON rs."id" = s."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "CourseImport" c
    JOIN rollout_user u ON u."id" = c."userId"
    WHERE c."courseId" = 'web3'
  )
  AND to_jsonb(expected) = to_jsonb(actual)
) AS safe_to_commit
FROM rollout_expected_preserved expected
CROSS JOIN rollout_actual_preserved actual
\gset post_

\if :post_safe_to_commit
  \echo 'Post-delete proof is clean. TRANSACTION IS STILL OPEN.'
\else
  \echo 'STOP: post-delete proof failed. Rolling back.'
  ROLLBACK;
  \quit
\endif
~~~

Now stop and read the outputs. On the first local rehearsal pass, enter
ROLLBACK. On the explicitly disposable local commit pass, or in production,
the human operator chooses exactly one command:

~~~sql
COMMIT;
-- or
ROLLBACK;
~~~

Do not let the psql connection close accidentally while deciding: disconnecting
with an open transaction rolls it back. Record the command and its output.

## 5. Restart, re-import, and verify

Restart the API whether the transaction committed or rolled back:

~~~bash
docker compose -f docker-compose.prod.yml --env-file .env.production start api
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=100 api
~~~

After a production COMMIT, sign in as the exact target user and import Web3 from
the Courses UI. The UI is preferred because it also recreates the web3
CourseImport marker. Do not start a learning session yet.

From the same reviewed production checkout, run the pure verifier tests and the
authenticated read-only sweep. TERRAIN_API must include the public /api prefix.
Do not set TERRAIN_NAME: a failed login must stop rather than register.

~~~bash
node --test scripts/import-web3.test.mjs
export TERRAIN_API='https://replace-with-domain.example/api'
export TERRAIN_EMAIL="$TARGET_EMAIL"
read -r -s -p 'Terrain password: ' TERRAIN_PASSWORD
echo
export TERRAIN_PASSWORD
unset TERRAIN_NAME
node scripts/import-web3.mjs --verify-only
unset TERRAIN_PASSWORD
~~~

The verifier must report VERIFY OK after checking:

- exactly the prepared Web3 normalized-title set, with no missing, extra, or
  duplicate titles;
- every expected pattern topic has a non-null source plan exactly equal to the
  deployed JSON;
- prompt and prerequisite-edge totals match;
- starter cards are not auto-generated and problem cards retain URLs.

Keep the original psql session open after COMMIT or ROLLBACK; its
`target_email` variable remains available. Check the UI-import marker and basic
database totals there, read-only:

~~~sql
SELECT
  count(*) AS web3_topics,
  count(*) FILTER (WHERE t."topicType" = 'pattern') AS web3_patterns,
  count(*) FILTER (
    WHERE t."topicType" = 'pattern' AND t."sourcePlan" IS NULL
  ) AS pattern_topics_without_source_plan
FROM "Topic" t
JOIN "User" u ON u."id" = t."userId"
WHERE u."email" = :'target_email'
  AND t."domain" = 'Web3';

SELECT count(*) AS web3_course_markers
FROM "CourseImport" c
JOIN "User" u ON u."id" = c."userId"
WHERE u."email" = :'target_email'
  AND c."courseId" = 'web3';
~~~

Expected after the final corpus is deployed: 457 Web3 topics, 360 patterns,
zero pattern topics without a source plan, and one UI-import marker. The
authenticated verifier is the authoritative source-plan equality check.

## 6. Mint the first production learning export

Before doing any session work, generate the first Web3 learning export in the
UI. Record the focus title and confirm:

- SOURCE PLAN contains real requirement and source IDs copied from deployed
  content;
- the conduct says the learner, not the model, performs the Build task;
- the output contract requires reconstruction evidence for every required
  first-exposure group;
- no LEGACY FIRST EXPOSURE BLOCKED message appears for the curated topic.

Do not import a generated session result until this export proof is recorded.
Task 10 then runs the complete production learning loop and records Preview
rejection for incomplete evidence before applying complete evidence.

## 7. Disposable local rehearsal

Run this before production against local Postgres on port 5433. Use plain
`docker compose` for every database command in this rehearsal; never use the
production Compose file or `.env.production`. Stop the host API first and
confirm `lsof -ti:3000` prints nothing.

1. Create two disposable users, import DSA and Web3 for the target user, and
   import at least one course for the control user.
2. Add representative target-user Web3 review/application/session/evidence
   rows through normal APIs, so dependent-table deletion is exercised.
3. Take a local custom-format backup and prove pg_restore can list it:

   ~~~bash
   umask 077
   LOCAL_BACKUP="/tmp/terrain-rollout-rehearsal-$(date -u +%Y%m%dT%H%M%SZ).dump"
   docker compose exec -T db \
     sh -lc 'exec pg_dump --format=custom --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
     > "$LOCAL_BACKUP"
   test -s "$LOCAL_BACKUP"
   docker compose exec -T db pg_restore --list < "$LOCAL_BACKUP" > "$LOCAL_BACKUP.list"
   test -s "$LOCAL_BACKUP.list"
   ~~~

4. Open psql with plain `docker compose`, paste the SQL blocks from Sections
   3–4, and enter ROLLBACK. Confirm every before count is unchanged:

   ~~~bash
   export TARGET_EMAIL='exact-disposable-target-email'
   docker compose exec -it -e TARGET_EMAIL="$TARGET_EMAIL" db sh -lc \
     'exec psql -X --set=ON_ERROR_STOP=1 --set=target_email="$TARGET_EMAIL" --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
   ~~~
5. Run Sections 3–4 again for the same disposable user and, only locally,
   enter COMMIT after the post-delete proof is clean.
6. Prove the control user's aggregate rows and the target user's DSA/non-Web3
   rows exactly match rollout_expected_preserved.
7. Restart the local API, re-import Web3 through Courses, and run
   `node scripts/import-web3.mjs --verify-only` with the disposable target's
   credentials.
8. Restore the local backup into a new, separately named disposable database;
   the `createdb` command must succeed, which proves the name did not already
   exist. Never add `--clean` and never restore over the working database:

   ~~~bash
   RESTORE_DB="terrain_rollout_restore_$(date -u +%Y%m%d%H%M%S)"
   docker compose exec -T -e RESTORE_DB="$RESTORE_DB" db sh -lc \
     'exec createdb --username="$POSTGRES_USER" "$RESTORE_DB"'
   docker compose exec -T -e RESTORE_DB="$RESTORE_DB" db sh -lc \
     'exec pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$RESTORE_DB"' \
     < "$LOCAL_BACKUP"
   docker compose exec -it -e RESTORE_DB="$RESTORE_DB" -e TARGET_EMAIL="$TARGET_EMAIL" db sh -lc \
     'exec psql -X --set=ON_ERROR_STOP=1 --set=target_email="$TARGET_EMAIL" --username="$POSTGRES_USER" --dbname="$RESTORE_DB"'
   ~~~

   Run the target/control count queries in that read-only restore session and
   compare them with the pre-delete record. Leave disposal of the restored
   database as a separate, explicit local operator action.

Record the exact commands and outputs in
.superpowers/sdd/source-grounded/rollout-verification.md. The local COMMIT is
authorized only for the disposable user; this document does not authorize a
production COMMIT.

## Rollback and recovery

- Before COMMIT: enter ROLLBACK. No durable row changes occur.
- After COMMIT but before re-import: keep the API stopped if an invariant is
  wrong, preserve the failed-state database, and restore the custom archive
  into a separate database first. Do not improvise an in-place partial restore.
- If re-import fails: do not patch sourcePlan rows. Save logs and verifier
  output, diagnose the deployed content/import defect, and either fix/deploy
  before retrying or restore the full backup during an explicit maintenance
  window.
- Never delete or overwrite the backup until the production session proof and
  a subsequent routine backup both exist.

## Production evidence record

Task 9 local evidence:

- Reviewed revision:
- Content tests / structural coverage / live URL result:
- Repository test totals:
- Local backup path, SHA-256, and pg_restore list result:
- Disposable target user:
- Disposable control user:
- ROLLBACK before/after counts:
- Local COMMIT deleted counts:
- DSA/non-Web3 preserved comparison:
- Other-user preserved comparison:
- Re-import totals and read-only verifier result:
- Independent runbook review:

Task 10 operator evidence:

- Deployed immutable revision/image:
- Host/container Web3 hash comparison:
- Production migration/content validation:
- Production backup absolute path, size, SHA-256, off-host copy, list result:
- Exact target email and resolved user ID:
- Before counts:
- Cross-domain guards:
- Locked-count comparison:
- Deleted counts:
- Post-delete preservation proof:
- Operator decision and COMMIT/ROLLBACK output:
- Re-import totals:
- Post-import 457/360/zero-null/one-marker counts:
- Read-only source-plan verifier result:
- First export focus and stored IDs:
- Incomplete Preview rejection:
- Complete Preview/Apply result:
- Review-session first-exposure behavior:
- Learner-authored application event proof:
- Final limitations or incidents:

Do not mark production complete until every Task 10 field is populated by the
human operator.
