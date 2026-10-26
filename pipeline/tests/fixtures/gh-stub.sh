#!/usr/bin/env bash
# A stand-in for the gh CLI over a state directory (tests/test_swap_release.py): releases are files
# $GH_STATE/rel_<tag> ("draft|published <sha> <assets> <title>"), git tags are $GH_STATE/tag_<tag> (<sha>).
# STUB_FAIL_PUBLISH=N makes the first N attempts to publish a draft (edit <*-run*> --tag ...) fail like an HTTP 502.
# STUB_502_AFTER_MOVE=N: the first N moves to a *-prev tag are applied but then answer 502 (the server did the move).
# STUB_API_FAIL=N: the first N `gh api -i` calls answer HTTP 403 (a rate limit); STUB_API_FAIL_TAG limits that to one tag.
# `gh api -i .../releases/tags/<t>` prints sha256:$GH_STATE/digest_<t> as the body when that file exists.
set -u
S=$GH_STATE
a2=${2:-}; cmd="$1 $a2"; shift 2 || true
arg() { local k=$1; shift; while [ $# -gt 0 ]; do [ "$1" = "$k" ] && { echo "$2"; return; }; shift; done; }
case "$cmd" in
  "repo view") echo "o/r" ;;
  "release view")
    t=$1; [ -f "$S/rel_$t" ] || exit 1
    read -r state sha n title < "$S/rel_$t"
    case "$*" in
      *assets*) echo "$n" ;;
      *isDraft*) [ "$state" = draft ] && echo true || echo false ;;
      *targetCommitish*) echo "$sha" ;;
    esac ;;
  "release create")
    t=$1; shift; target=$(arg --target "$@"); title=$(arg --title "$@")
    n=0; while [ $# -gt 0 ]; do case "$1" in --target|--title|--notes) shift 2 ;; --*) shift ;; *) n=$((n+1)); shift ;; esac; done
    echo "draft $target $n $title" > "$S/rel_$t" ;;
  "release delete")
    t=$1; [ -f "$S/rel_$t" ] || exit 1
    rm "$S/rel_$t"; case "$*" in *--cleanup-tag*) rm -f "$S/tag_$t" ;; esac ;;
  "release edit")
    t=$1; shift; [ -f "$S/rel_$t" ] || exit 1
    new=$(arg --tag "$@"); target=$(arg --target "$@"); title=$(arg --title "$@")
    if [[ "$t" == *-run* ]]; then
      c=$(cat "$S/fails" 2>/dev/null || echo 0)
      if [ "$c" -lt "${STUB_FAIL_PUBLISH:-0}" ]; then echo $((c+1)) > "$S/fails"; echo "HTTP 502" >&2; exit 1; fi
    fi
    read -r state sha n old_title < "$S/rel_$t"
    case "$*" in *--draft=false*) state=published ;; esac
    sha=${target:-$sha}; title=${title:-$old_title}
    rm "$S/rel_$t"
    [ -f "$S/tag_$new" ] || echo "$sha" > "$S/tag_$new"
    echo "$state $(cat "$S/tag_$new") $n $title" > "$S/rel_$new"
    if [[ "$new" == *-prev ]]; then
      c=$(cat "$S/movefails" 2>/dev/null || echo 0)
      if [ "$c" -lt "${STUB_502_AFTER_MOVE:-0}" ]; then echo $((c+1)) > "$S/movefails"; echo "HTTP 502" >&2; exit 1; fi
    fi ;;
  "api -i")
    p=$1; t=${p##*/tags/}
    c=$(cat "$S/apifails" 2>/dev/null || echo 0)
    if [ "$c" -lt "${STUB_API_FAIL:-0}" ] && [ "${STUB_API_FAIL_TAG:-$t}" = "$t" ]; then
      echo $((c+1)) > "$S/apifails"; printf 'HTTP/2.0 403 Forbidden\r\n\r\n{"message":"API rate limit exceeded"}\n'; exit 1
    fi
    if [ -f "$S/rel_$t" ] && [ "$(cut -d' ' -f1 "$S/rel_$t")" = published ]; then
      printf 'HTTP/2.0 200 OK\r\n\r\n'
      if [ -f "$S/digest_$t" ]; then echo "sha256:$(cat "$S/digest_$t")"; else echo "$t"; fi
    else
      printf 'HTTP/2.0 404 Not Found\r\n\r\n'; exit 1
    fi ;;
  "api -X")
    t=${2##*/tags/}; [ -f "$S/tag_$t" ] || exit 1; rm "$S/tag_$t" ;;
  "api repos/"*)
    t=${a2##*/tags/}; [ -f "$S/tag_$t" ] || exit 1; cat "$S/tag_$t" ;;
  *) echo "gh stub: unsupported: $cmd $*" >&2; exit 2 ;;
esac
