#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/usr/local/bin"
WEB_DIST_DIR="/usr/local/share/quantclaw/web/dist"
SERVICE_DIR="/etc/systemd/system"
SERVICE_NAME="quantclaw-rust.service"

QUANTCLAW_USER="${QUANTCLAW_USER:-quant}"
QUANTCLAW_HOME="$(getent passwd "$QUANTCLAW_USER" | cut -d: -f6 2>/dev/null || printf '/home/%s' "$QUANTCLAW_USER")"
INSTALL_SOURCE_DIR="$(pwd)"
APP_ROOT="${QUANTCLAW_APP_ROOT:-${QUANTCLAW_HOME}/quantclaw_rust_app}"
APP_DIR="${QUANTCLAW_APP_DIR:-${APP_ROOT}/current}"
CONFIG_DIR="${QUANTCLAW_CONFIG_DIR:-${APP_ROOT}/.quantclaw}"
ENV_FILE="${APP_ROOT}/.env"

info() {
    printf '[*] %s\n' "$*"
}

die() {
    printf '[!] %s\n' "$*" >&2
    exit 1
}

require_file() {
    local path="$1"
    [[ -e "$path" ]] || die "Missing required file: $path"
}

install_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        return 0
    fi

    cat > "$ENV_FILE" <<'ENVEOF'
# Set one provider key before first real use.
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
MINIMAX_API_KEY=
ENVEOF
    chmod 600 "$ENV_FILE"
}

patch_config_paths() {
    local config_file="$1"

    sed -i \
        -e "s|^state_file = .*|state_file = \"${CONFIG_DIR}/estop-state.json\"|" \
        -e "s|^db_path = .*|db_path = \"${CONFIG_DIR}/agents.db\"|" \
        -e "s|^web_dist_dir = .*|web_dist_dir = \"${WEB_DIST_DIR}\"|" \
        "$config_file"
}

install_service() {
    local service_dest="${SERVICE_DIR}/${SERVICE_NAME}"

    require_file "quantclaw-rust.service"
    cp "quantclaw-rust.service" "$service_dest"

    sed -i \
        -e "s|__QUANTCLAW_USER__|${QUANTCLAW_USER}|g" \
        -e "s|__QUANTCLAW_HOME__|${QUANTCLAW_HOME}|g" \
        -e "s|__QUANTCLAW_APP_DIR__|${APP_DIR}|g" \
        -e "s|__QUANTCLAW_CONFIG_DIR__|${CONFIG_DIR}|g" \
        -e "s|__QUANTCLAW_ENV_FILE__|${ENV_FILE}|g" \
        "$service_dest"

    systemctl disable zeroclaw quantclaw quantclaw-rust 2>/dev/null || true
    rm -f "${SERVICE_DIR}/zeroclaw.service" "${SERVICE_DIR}/quantclaw.service"
    systemctl daemon-reload
    systemctl enable quantclaw-rust
    systemctl restart quantclaw-rust
}

main() {
    printf '=== QuantClaw Raspberry Pi install ===\n\n'

    [[ ${EUID} -eq 0 ]] || die "Run this install script with sudo"
    [[ $(uname -m) == "aarch64" ]] || die "This installer targets aarch64 Raspberry Pi systems"

    require_file "quantclaw"
    require_file "rpi-config.toml"

    if [[ -d "web/dist" ]]; then
        require_file "web/dist/index.html"
    fi

    info "Installing quantclaw binary"
    install -m 755 "quantclaw" "${INSTALL_DIR}/quantclaw"

    info "Preparing runtime layout"
    mkdir -p "$APP_ROOT" "$CONFIG_DIR" "$CONFIG_DIR/workspace"
    ln -sfn "$INSTALL_SOURCE_DIR" "$APP_DIR"
    install_env_file

    if [[ -f "${CONFIG_DIR}/config.toml" ]]; then
        backup_path="${CONFIG_DIR}/config.toml.bak.$(date +%Y%m%d%H%M%S)"
        info "Backing up existing config to ${backup_path}"
        cp "${CONFIG_DIR}/config.toml" "$backup_path"
    fi

    info "Installing config template"
    install -m 600 "rpi-config.toml" "${CONFIG_DIR}/config.toml"
    patch_config_paths "${CONFIG_DIR}/config.toml"

    if [[ -d "web/dist" ]]; then
        info "Installing web assets to ${WEB_DIST_DIR}"
        mkdir -p "$WEB_DIST_DIR"
        rm -rf "${WEB_DIST_DIR:?}/"*
        cp -r "web/dist/." "$WEB_DIST_DIR/"
    fi

    info "Migrating config to current schema"
    "${INSTALL_DIR}/quantclaw" config migrate --config-dir "$CONFIG_DIR"

    chown -R "${QUANTCLAW_USER}:${QUANTCLAW_USER}" "$APP_ROOT" "$CONFIG_DIR" "$ENV_FILE" 2>/dev/null || true

    info "Installing systemd service"
    install_service

    printf '\n=== Install complete ===\n\n'
    printf 'Config path: %s\n' "${CONFIG_DIR}/config.toml"
    printf 'Gateway URL: http://%s:42617\n' "$(hostname -I | awk '{print $1}')"
    printf '\nValidation:\n'
    printf '  curl -sSf http://127.0.0.1:42617/health\n'
    printf '  sudo journalctl -u quantclaw-rust -n 80 --no-pager\n'
}

main "$@"
