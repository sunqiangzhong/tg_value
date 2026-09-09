#!/usr/bin/env bash
set -Eeuo pipefail
container="tg-vault-smoke-$RANDOM"
volume="$container-data"
cleanup() {
    docker logs "$container" || true
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run -d --name "$container" -p 127.0.0.1:18080:51947 \
    -e UPDATE_CHECK_ENABLED=false -v "$volume:/data" tg-vault:test
wait_ready() {
    for ((i=0; i<90; i++)); do
        [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == true ]] || return 1
        if curl -fsS http://127.0.0.1:18080/readyz >/dev/null; then return; fi
        sleep 2
    done
    return 1
}
wait_ready
curl -fsS http://127.0.0.1:18080/ | grep -q '<html'
curl -fsS http://127.0.0.1:18080/settings | grep -q '<html'
[[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/not-a-route)" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://untrusted.example' -X POST http://127.0.0.1:18080/api/auth/login)" == 403 ]]
docker exec -u postgres "$container" psql -h /run/postgresql -d tgvault -c 'CREATE TABLE nas_smoke (value text); INSERT INTO nas_smoke VALUES ('"'persisted'"');'
docker exec -u node "$container" node -e "require('fs').writeFileSync('/data/uploads/smoke.txt', 'persisted')"
docker stop -t 60 "$container"
[[ "$(docker inspect -f '{{.State.ExitCode}}' "$container")" == 0 ]]
docker rm "$container"
docker run -d --name "$container" -p 127.0.0.1:18080:51947 \
    -e UPDATE_CHECK_ENABLED=false -v "$volume:/data" tg-vault:test
wait_ready
[[ "$(docker exec -u postgres "$container" psql -h /run/postgresql -d tgvault -Atc 'SELECT value FROM nas_smoke')" == persisted ]]
[[ "$(docker exec "$container" cat /data/uploads/smoke.txt)" == persisted ]]
# The supervisor may stop PID 1 before docker exec returns; 137 is expected in that race.
set +e
docker exec -u postgres "$container" pg_ctl -D /data/postgres -m fast -W stop
stop_status=$?
set -e
[[ "$stop_status" == 0 || "$stop_status" == 137 ]]
for ((i=0; i<45; i++)); do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == false ]]; then
        [[ "$(docker inspect -f '{{.State.ExitCode}}' "$container")" != 0 ]]
        exit 0
    fi
    sleep 1
done
echo 'Container failed to exit after PostgreSQL stopped' >&2
exit 1
