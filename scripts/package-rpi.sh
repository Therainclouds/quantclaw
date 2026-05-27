#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${TARGET:-aarch64-unknown-linux-gnu}"
PACKAGE_TRIPLE="${PACKAGE_TRIPLE:-aarch64-linux-gnu}"
FEATURES="${FEATURES:-hardware,peripheral-rpi}"
DIST_DIR="${DIST_DIR:-${ROOT_DIR}/dist}"
PACKAGE_NAME_PREFIX="${PACKAGE_NAME_PREFIX:-quantclaw}"
BUILD_PROFILE="${BUILD_PROFILE:-release}"
PACKAGE_BINARY_NAME="quantclaw"
BUILD_BINARY_PATH="${ROOT_DIR}/target/${TARGET}/${BUILD_PROFILE}/zeroclaw"
WEB_DIST_PATH="${ROOT_DIR}/web/dist"

info() {
    printf '==> %s\n' "$*"
}

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

workspace_version() {
    awk '
        /^\[workspace\.package\]/ { in_section = 1; next }
        /^\[/ && in_section { in_section = 0 }
        in_section && /^version *=/ {
            split($0, parts, "\"")
            print parts[2]
            exit
        }
    ' "${ROOT_DIR}/Cargo.toml"
}

detect_cross_tool() {
    if [[ "${CROSS_TOOL:-}" == "cross" ]]; then
        echo "cross"
        return
    fi
    if [[ "${CROSS_TOOL:-}" == "zigbuild" ]]; then
        echo "zigbuild"
        return
    fi
    if [[ "${CROSS_TOOL:-}" == "native" ]]; then
        echo "native"
        return
    fi
    if [[ "$(uname -s)" == "Linux" && "$(uname -m)" =~ ^(aarch64|arm64)$ ]]; then
        echo "native"
        return
    fi
    if command -v cargo-zigbuild >/dev/null 2>&1 && command -v zig >/dev/null 2>&1; then
        echo "zigbuild"
        return
    fi
    if command -v cross >/dev/null 2>&1; then
        echo "cross"
        return
    fi
    echo "none"
}

build_binary() {
    local tool="$1"

    case "$tool" in
        native)
            info "Using native cargo build"
            cargo build --release --features "${FEATURES}" --target "${TARGET}"
            ;;
        zigbuild)
            info "Using cargo-zigbuild"
            rustup target add "${TARGET}" 2>/dev/null || true
            cargo zigbuild --release --features "${FEATURES}" --target "${TARGET}"
            ;;
        cross)
            info "Using cross"
            docker info >/dev/null 2>&1 || die "Docker is not running; start Docker or install cargo-zigbuild"
            cross build --release --features "${FEATURES}" --target "${TARGET}"
            ;;
        *)
            die "No cross-compilation tool found. Install cargo-zigbuild or cross, or set CROSS_TOOL=native on an aarch64 Linux host."
            ;;
    esac
}

build_web_dashboard() {
    info "Building web dashboard"
    (cd "${ROOT_DIR}" && cargo web build)
    [[ -f "${WEB_DIST_PATH}/index.html" ]] || die "web/dist/index.html not found after cargo web build"
}

stage_package() {
    local version="$1"
    local package_base="${PACKAGE_NAME_PREFIX}-${version}-${PACKAGE_TRIPLE}"
    local package_dir="${DIST_DIR}/${package_base}"

    rm -rf "$package_dir"
    mkdir -p "${package_dir}/web"

    install -m 755 "${BUILD_BINARY_PATH}" "${package_dir}/${PACKAGE_BINARY_NAME}"
    install -m 755 "${ROOT_DIR}/scripts/rpi-install/install.sh" "${package_dir}/install.sh"
    install -m 644 "${ROOT_DIR}/scripts/rpi-install/quantclaw-rust.service" "${package_dir}/quantclaw-rust.service"
    install -m 644 "${ROOT_DIR}/scripts/rpi-config.toml" "${package_dir}/rpi-config.toml"
    cp -r "${WEB_DIST_PATH}" "${package_dir}/web/dist"

    tar -C "${DIST_DIR}" -czf "${DIST_DIR}/${package_base}.tar.gz" "${package_base}"

    info "Package directory: ${package_dir}"
    info "Tarball: ${DIST_DIR}/${package_base}.tar.gz"
}

main() {
    cd "${ROOT_DIR}"

    local version
    version="$(workspace_version)"
    [[ -n "$version" ]] || die "Failed to read workspace version from Cargo.toml"

    local tool
    tool="$(detect_cross_tool)"

    info "Packaging ${PACKAGE_NAME_PREFIX} ${version} for ${TARGET}"
    info "Features: default + ${FEATURES}"
    mkdir -p "${DIST_DIR}"

    build_web_dashboard
    build_binary "$tool"

    [[ -f "${BUILD_BINARY_PATH}" ]] || die "Build output not found at ${BUILD_BINARY_PATH}"
    stage_package "$version"
}

main "$@"
