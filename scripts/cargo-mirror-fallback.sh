#!/bin/sh

set -eu

usage() {
  echo "usage: cargo-mirror-fallback.sh <cargo|rustup> <command> [args...]" >&2
  exit 64
}

[ $# -ge 2 ] || usage

MODE="$1"
shift

CARGO_HOME_DIR="${CARGO_HOME:-/usr/local/cargo}"
CONFIG_PATH="${CARGO_HOME_DIR}/config.toml"
BACKUP_PATH="${CONFIG_PATH}.quantclaw-backup.$$"

mkdir -p "$CARGO_HOME_DIR"
export PATH="${CARGO_HOME_DIR}/bin:${PATH}"

restore_config() {
  if [ -f "$BACKUP_PATH" ]; then
    mv "$BACKUP_PATH" "$CONFIG_PATH"
  else
    rm -f "$CONFIG_PATH"
  fi
}

backup_config() {
  if [ -f "$CONFIG_PATH" ] && [ ! -f "$BACKUP_PATH" ]; then
    cp "$CONFIG_PATH" "$BACKUP_PATH"
  fi
}

write_official_cargo_config() {
  backup_config
  cat >"$CONFIG_PATH" <<'EOF'
[net]
git-fetch-with-cli = true

[http]
multiplexing = false
timeout = 600

[registries.crates-io]
protocol = "sparse"
EOF
}

write_cargo_config() {
  mirror_name="$1"
  registry_url="$2"

  backup_config
  cat >"$CONFIG_PATH" <<EOF
[source.crates-io]
replace-with = "${mirror_name}"

[source.${mirror_name}]
registry = "${registry_url}"

[registries.${mirror_name}]
index = "${registry_url}"

[net]
git-fetch-with-cli = true

[http]
multiplexing = false
timeout = 600
EOF
}

run_with_cargo_mirrors() {
  export CARGO_NET_GIT_FETCH_WITH_CLI="${CARGO_NET_GIT_FETCH_WITH_CLI:-true}"
  export CARGO_HTTP_MULTIPLEXING="${CARGO_HTTP_MULTIPLEXING:-false}"
  export CARGO_HTTP_TIMEOUT="${CARGO_HTTP_TIMEOUT:-600}"
  export CARGO_NET_RETRY="${CARGO_NET_RETRY:-2}"

  while IFS='|' read -r mirror_name registry_url; do
    [ -n "$mirror_name" ] || continue

    if [ "$mirror_name" = "official" ]; then
      write_official_cargo_config
      echo "==> cargo mirror fallback: trying official crates.io" >&2
    else
      write_cargo_config "$mirror_name" "$registry_url"
      echo "==> cargo mirror fallback: trying ${mirror_name}" >&2
    fi

    if "$@"; then
      return 0
    fi

    echo "==> cargo mirror fallback: ${mirror_name} failed, switching to next mirror" >&2
  done <<'EOF'
rsproxy-sparse|sparse+https://rsproxy.cn/index/
ustc-sparse|sparse+https://mirrors.ustc.edu.cn/crates.io-index/
sjtu-sparse|sparse+https://mirrors.sjtug.sjtu.edu.cn/crates.io-index/
tuna-sparse|sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/
bfsu-sparse|sparse+https://mirrors.bfsu.edu.cn/crates.io-index/
cqu-sparse|sparse+https://mirrors.cqu.edu.cn/crates.io-index/
zju-sparse|sparse+https://mirrors.zju.edu.cn/crates.io-index/
cernet-sparse|sparse+https://mirrors.cernet.edu.cn/crates.io-index/
aliyun-sparse|sparse+https://mirrors.aliyun.com/crates.io-index/
nju|https://mirror.nju.edu.cn/git/crates.io-index.git
official|
EOF

  return 1
}

run_with_rustup_mirrors() {
  while IFS='|' read -r mirror_name dist_server update_root; do
    [ -n "$mirror_name" ] || continue

    if [ "$mirror_name" = "official" ]; then
      unset RUSTUP_DIST_SERVER
      unset RUSTUP_UPDATE_ROOT
      echo "==> rustup mirror fallback: trying official rustup" >&2
    else
      export RUSTUP_DIST_SERVER="$dist_server"
      export RUSTUP_UPDATE_ROOT="$update_root"
      echo "==> rustup mirror fallback: trying ${mirror_name}" >&2
    fi

    if "$@"; then
      return 0
    fi

    echo "==> rustup mirror fallback: ${mirror_name} failed, switching to next mirror" >&2
  done <<'EOF'
rsproxy|https://rsproxy.cn|https://rsproxy.cn/rustup
ustc|https://mirrors.ustc.edu.cn/rust-static|https://mirrors.ustc.edu.cn/rust-static/rustup
tuna|https://mirrors.tuna.tsinghua.edu.cn/rustup|https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup
sjtu|https://mirrors.sjtug.sjtu.edu.cn/rust-static|https://mirrors.sjtug.sjtu.edu.cn/rust-static/rustup
official||
EOF

  return 1
}

trap restore_config EXIT HUP INT TERM

case "$MODE" in
  cargo)
    run_with_cargo_mirrors "$@"
    ;;
  rustup)
    run_with_rustup_mirrors "$@"
    ;;
  *)
    usage
    ;;
esac
