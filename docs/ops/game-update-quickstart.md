# Update Terrain on the existing game server

For the configured `game` host (`terrain.yarre.uk`), with its existing database,
Compose file and secrets. The server directory is not a Git checkout. Build on
your Mac and transfer the images; a GitHub push is not required for this deploy.
The full reference is [the deployment runbook](deploy.md).

## 1. Build and transfer from the Mac

Commit the intended Terrain changes first and confirm `git status --short` is
empty, so the image tag identifies the source you are actually building.
Start OrbStack/Docker, then run from the Terrain repository. Check the server
architecture with `ssh game uname -m`: choose `linux/amd64` for `x86_64` or
`linux/arm64` for `aarch64`. Run each command separately and stop if it fails.

```sh
cd /Users/dmitrijgorbatenko/personal/consistency
tag=$(git rev-parse --short HEAD)
platform=linux/amd64 # change if game reports aarch64
docker buildx build --platform "$platform" --load -t "terrain-api:$tag" -f apps/api/Dockerfile .
docker buildx build --platform "$platform" --load -t "terrain-web:$tag" -f apps/web/Dockerfile .
docker save "terrain-api:$tag" "terrain-web:$tag" | gzip -1 > "/tmp/terrain-images-$tag.tar.gz"
scp "/tmp/terrain-images-$tag.tar.gz" game:/tmp/
echo "$tag"
ssh game
```

## 2. Load the images on game

These commands use the server's fish shell. Replace `COMMIT_TAG` with the tag
printed on the Mac. Keep the existing `.env.production` and `apps/api/.env`.
No Compose file changed in this update, so no configuration transfer is needed.

```fish
cd /home/uyuyuy/apps/terrain/consistency
set -gx TERRAIN_IMAGE_TAG COMMIT_TAG
gzip -dc /tmp/terrain-images-$TERRAIN_IMAGE_TAG.tar.gz | docker load
printf 'services:\n  api:\n    image: terrain-api:%s\n    pull_policy: never\n  web:\n    image: terrain-web:%s\n    pull_policy: never\n' $TERRAIN_IMAGE_TAG $TERRAIN_IMAGE_TAG > /tmp/terrain-prebuilt.yml
function terrain_compose
    docker compose -f docker-compose.prod.yml -f /tmp/terrain-prebuilt.yml --env-file .env.production $argv
end
```

## 3. Back up, migrate, restart

Run individually. **Stop on any backup or migration failure.** This changeset
adds no database migration, but `migrate deploy` safely applies any older pending
migrations. Do not reset the database or remove its volume.

```fish
terrain_compose up -d db
terrain_compose exec db sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
mkdir -p backups
set backup "backups/terrain-before-update-"(date -u +%Y%m%dT%H%M%SZ)".dump"
terrain_compose exec -T db sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > $backup
terrain_compose exec -T db pg_restore --list < $backup > /dev/null
terrain_compose run --rm --no-deps api ../../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
terrain_compose run --rm --no-deps api ../../node_modules/.bin/prisma migrate status --schema prisma/schema.prisma
terrain_compose up -d --no-build api web
terrain_compose ps
terrain_compose logs --tail=60 api
```

## 4. Verify

Open `https://terrain.yarre.uk`, sign in, and open a topic. Confirm that **Practice
& artifacts** and **Skill checks** are visible and that notes still load. Record
only real practice; opening the planning form must not schedule a check. Browser
smoke was blocked in the build environment, so this check remains necessary.

Keep the previous images until verification succeeds. For subsequent API/web
commands use the same Compose override; recreate it if `/tmp` has been cleared.
Course source metadata for existing topics needs the normal curriculum-update
flow separately; deployment does not overwrite personal notes or reimport topics.
