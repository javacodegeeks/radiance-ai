#!/usr/bin/env bash
#
# One-off exploration tool: pulls raw JSON from the EU Commission's
# "search-api" backend that powers CosIng's reference pages. Confirmed via
# DevTools capture — see docs/specs/cosing-functions-classification-enrichment.md.
#
# This is NOT the pipeline loader. It only dumps raw API responses to disk
# for inspection. The actual idempotent Mongo load belongs in a TS script
# under data/pipeline/ (following 06-load-cosing-restrictions.ts /
# 07-load-cosing-prohibited.ts), once the ingredient response shape is fully
# confirmed.
#
# Query params + POST multipart/form-data body (fields "query" and, for
# api1, "sort") are reproduced verbatim from DevTools capture:
#
#   api1     = Functions glossary (itemType:function, sorted by functionName ASC)
#   api2     = Ingredients & Substances scoped to functionName:ABRASIVE (as captured)
#   api2-all = api2's exact query shape, repeated once per functionName returned
#              by api1 (83 calls) — confirmed to be how the CosIng UI itself
#              browses ingredients per function, not an invented loop.
#
# Pagination: confirmed empirically (page 2 of a 126-result function returned
# exactly the remaining 26 entries, zero overlap with page 1) that pageNumber
# advancement works correctly. api2 and api2-all now loop pages per query
# until all of totalResults is collected, using pageSize=200 (the confirmed
# server-enforced ceiling) to minimize round-trips.
#
# Scale warning: some functions are large — e.g. SKIN CONDITIONING has 12,506
# matching ingredients (63 pages at pageSize=200). Across all 83 functions,
# a full api2-all pull is ~330 requests total. This hits a shared,
# undocumented government endpoint — treat as a deliberate one-time batch
# pull, not something to run repeatedly.
#
# Usage:
#   ./fetch-cosing-search-api.sh --api-key KEY api1 --out functions.json
#   ./fetch-cosing-search-api.sh --api-key KEY api2 --out ingredients-abrasive.json
#   ./fetch-cosing-search-api.sh --api-key KEY api2-all --out-dir ingredients-by-function/
#
# Requires: curl, jq

set -euo pipefail

BASE_URL="https://webgate.ec.europa.eu/es/search-api/rest/search"
PAGE_SIZE=200 # server-enforced ceiling, confirmed empirically

usage() {
  echo "Usage: $0 --api-key KEY api1|api2 --out FILE" >&2
  echo "       $0 --api-key KEY api2-all --out-dir DIR" >&2
  exit 2
}

API_KEY=""
WHICH=""
OUT=""
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-key)         API_KEY="$2"; shift 2 ;;
    --out)             OUT="$2"; shift 2 ;;
    --out-dir)         OUT_DIR="$2"; shift 2 ;;
    api1|api2|api2-all) WHICH="$1"; shift ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

if [[ -z "$API_KEY" || -z "$WHICH" ]]; then
  usage
fi
if [[ "$WHICH" == "api2-all" && -z "$OUT_DIR" ]]; then
  usage
fi
if [[ "$WHICH" != "api2-all" && -z "$OUT" ]]; then
  usage
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# Fetches one page from the search-api via POST multipart/form-data.
# Args: query_json sort_json_or_empty url out_file
# Echoes the HTTP status code; returns curl's own exit status.
fetch_one() {
  local query_json="$1" sort_json="$2" url="$3" out_file="$4"
  local query_file="${TMP_DIR}/q_$$_${RANDOM}.json"
  printf '%s' "$query_json" > "$query_file"

  local curl_args=(-sS -o "$out_file" -w '%{http_code}' -X POST
    -F "query=@${query_file};type=application/json;filename=blob")
  if [[ -n "$sort_json" ]]; then
    local sort_file="${TMP_DIR}/s_$$_${RANDOM}.json"
    printf '%s' "$sort_json" > "$sort_file"
    curl_args+=(-F "sort=@${sort_file};type=application/json;filename=blob")
  fi

  curl "${curl_args[@]}" "$url"
}

# Loops pageNumber=1,2,... for one query until all of totalResults has been
# collected, merging every page's results into out_file as one JSON object.
# Args: query_json sort_json_or_empty url_prefix(without pageNumber) out_file label
# Returns 0 on success (out_file written), 1 on any page failing.
fetch_all_pages() {
  local query_json="$1" sort_json="$2" url_prefix="$3" out_file="$4" label="$5"
  local page=1 fetched=0 total=-1
  local merge_dir="${TMP_DIR}/merge_$$_${RANDOM}"
  mkdir -p "$merge_dir"

  while true; do
    local page_file="${merge_dir}/page_${page}.json"
    local url="${url_prefix}&pageNumber=${page}"
    local status
    if ! status=$(fetch_one "$query_json" "$sort_json" "$url" "$page_file"); then
      echo "  FAILED (${label}, page ${page}): curl error" >&2
      return 1
    fi
    if [[ "$status" != "200" ]]; then
      echo "  FAILED (${label}, page ${page}): HTTP ${status}" >&2
      return 1
    fi

    total=$(jq '.totalResults // 0' "$page_file")
    local page_count
    page_count=$(jq '.results | length' "$page_file")
    fetched=$(( fetched + page_count ))

    if (( page_count == 0 )) || (( fetched >= total )); then
      break
    fi
    page=$(( page + 1 ))
  done

  jq -s '{
    fetchedAt: (now | todate),
    totalResults: (.[0].totalResults // 0),
    results: [.[].results[]]
  }' "$merge_dir"/page_*.json > "$out_file"

  rm -rf "$merge_dir"
}

case "$WHICH" in
  api1)
    # Captured query param: apiKey&text=*&pageSize=500 (no pageNumber given).
    # 83 results fit in one page; no pagination loop needed here.
    url="${BASE_URL}?apiKey=${API_KEY}&text=*&pageSize=500"
    http_status=$(fetch_one \
      '{"bool":{"must":[{"term":{"itemType":"function"}}]}}' \
      '[{"field":"functionName","order":"ASC"}]' \
      "$url" "$OUT")
    if [[ "$http_status" != "200" ]]; then
      echo "Request failed (HTTP ${http_status})" >&2
      exit 1
    fi
    ;;
  api2)
    # Same query as originally captured (itemType:ingredient,
    # functionName:ABRASIVE, status:Active), now paginated through all pages.
    url_prefix="${BASE_URL}?apiKey=${API_KEY}&text=*&pageSize=${PAGE_SIZE}"
    if ! fetch_all_pages \
      '{"bool":{"must":[{"term":{"itemType":"ingredient"}},{"term":{"functionName":"ABRASIVE"}},{"term":{"status":"Active"}}]}}' \
      '' "$url_prefix" "$OUT" "ABRASIVE"; then
      exit 1
    fi
    ;;
  api2-all)
    OUT_DIR="${OUT_DIR%/}"
    mkdir -p "$OUT_DIR"

    functions_file="${TMP_DIR}/functions.json"
    functions_url="${BASE_URL}?apiKey=${API_KEY}&text=*&pageSize=500"
    fstatus=$(fetch_one \
      '{"bool":{"must":[{"term":{"itemType":"function"}}]}}' \
      '[{"field":"functionName","order":"ASC"}]' \
      "$functions_url" "$functions_file")
    if [[ "$fstatus" != "200" ]]; then
      echo "Failed to fetch function list (HTTP ${fstatus})" >&2
      exit 1
    fi

    function_names_file="${TMP_DIR}/function_names.txt"
    jq -r '.results[].metadata.functionName[0]' "$functions_file" > "$function_names_file"
    echo "Fetched $(wc -l < "$function_names_file" | tr -d ' ') function names from api1. Querying ingredients per function (paginated)..." >&2

    while IFS= read -r fn; do
      # printf (not echo) avoids adding a trailing newline that tr would
      # otherwise convert into a stray trailing underscore; -s squeezes runs
      # of underscores (e.g. from spaces) down to one.
      safe_name=$(printf '%s' "$fn" | tr -cs '[:alnum:]' '_')
      out_file="${OUT_DIR}/${safe_name}.json"
      url_prefix="${BASE_URL}?apiKey=${API_KEY}&text=*&pageSize=${PAGE_SIZE}"
      # Same query shape as api2, with functionName substituted per api1 entry
      # (confirmed to be exactly what the CosIng UI does, not an invented loop).
      query_json=$(jq -n --arg fn "$fn" \
        '{"bool":{"must":[{"term":{"itemType":"ingredient"}},{"term":{"functionName":$fn}},{"term":{"status":"Active"}}]}}')

      if ! fetch_all_pages "$query_json" '' "$url_prefix" "$out_file" "$fn"; then
        continue
      fi

      total=$(jq '.totalResults // 0' "$out_file")
      count=$(jq '.results | length' "$out_file")
      echo "  ${fn}: ${count}/${total}" >&2
    done < "$function_names_file"

    # Summary: confirm every file's results count now matches totalResults.
    echo >&2
    echo "Summary:" >&2
    for f in "${OUT_DIR}"/*.json; do
      [[ -s "$f" ]] || { echo "  UNREADABLE: $(basename "$f") (empty or missing)" >&2; continue; }
      jq -r --arg f "$(basename "$f")" \
        'if (.results | length) < .totalResults
         then "  INCOMPLETE: \($f)  (\(.results | length)/\(.totalResults))"
         else "  complete:   \($f)  (\(.results | length)/\(.totalResults))"
         end' "$f" 2>/dev/null || echo "  UNREADABLE: $(basename "$f") (not valid JSON)" >&2
    done | sort >&2

    echo "Done. Per-function results in ${OUT_DIR}/" >&2
    exit 0
    ;;
esac

total_results=$(jq '.totalResults // 0' "$OUT")
result_count=$(jq '.results | length' "$OUT")
echo "Wrote ${result_count} results (totalResults=${total_results}) to ${OUT}" >&2
