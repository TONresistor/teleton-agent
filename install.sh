#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# Teleton Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/TONresistor/teleton-agent/main/install.sh | bash
# ──────────────────────────────────────────────

REPO="TONresistor/teleton-agent"
DOCKER_IMAGE="ghcr.io/${REPO}:latest"
NPM_PACKAGE="teleton"
MIN_NODE_VERSION=20

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Detect OS ──
detect_os() {
  case "$(uname -s)" in
    Linux*)  OS="linux" ;;
    Darwin*) OS="macos" ;;
    MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
    *) error "Unsupported OS: $(uname -s)" ;;
  esac
  info "Detected OS: ${OS}"
}

# ── Check if command exists ──
has() { command -v "$1" &>/dev/null; }

# ── Check Node.js version ──
check_node() {
  if ! has node; then
    return 1
  fi
  local version
  version=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$version" -ge "$MIN_NODE_VERSION" ]; then
    ok "Node.js v$(node -v | sed 's/v//') found"
    return 0
  else
    warn "Node.js v$(node -v | sed 's/v//') found (need >= ${MIN_NODE_VERSION})"
    return 1
  fi
}

# ── Install via npm ──
install_npm() {
  info "Installing via npm..."
  if npm install -g "${NPM_PACKAGE}"; then
    ok "Teleton installed via npm"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo "  teleton setup    # Configure your agent"
    echo "  teleton start    # Start the agent"
    echo "  teleton doctor   # Run health checks"
  else
    error "npm install failed. Try: sudo npm install -g ${NPM_PACKAGE}"
  fi
}

# ── Install via Docker ──
install_docker() {
  info "Pulling Docker image..."
  if docker pull "${DOCKER_IMAGE}"; then
    ok "Teleton Docker image pulled"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo "  # Setup (interactive)"
    echo "  docker run -it -v ~/.teleton:/data ${DOCKER_IMAGE} setup"
    echo ""
    echo "  # Start agent (background)"
    echo "  docker run -d -v ~/.teleton:/data --name teleton ${DOCKER_IMAGE}"
    echo ""
    echo "  # Health check"
    echo "  docker run -it -v ~/.teleton:/data ${DOCKER_IMAGE} doctor"
  else
    error "Docker pull failed"
  fi
}

# ── Install via git clone ──
install_git() {
  local install_dir="${HOME}/.teleton-app"
  info "Cloning repository to ${install_dir}..."

  if [ -d "${install_dir}" ]; then
    warn "Directory ${install_dir} already exists, updating..."
    git -C "${install_dir}" pull --ff-only
  else
    git clone "https://github.com/${REPO}.git" "${install_dir}"
  fi

  info "Installing dependencies..."
  (cd "${install_dir}" && npm install)

  info "Building..."
  (cd "${install_dir}" && npm run build)

  # Create symlink
  local bin_dir="${HOME}/.local/bin"
  mkdir -p "${bin_dir}"
  ln -sf "${install_dir}/bin/teleton.js" "${bin_dir}/teleton"

  if echo "$PATH" | grep -q "${bin_dir}"; then
    ok "Teleton installed to ${bin_dir}/teleton"
  else
    ok "Teleton installed to ${bin_dir}/teleton"
    warn "Add to your PATH: export PATH=\"${bin_dir}:\$PATH\""
    echo "  Add this to your ~/.bashrc or ~/.zshrc"
  fi

  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo "  teleton setup    # Configure your agent"
  echo "  teleton start    # Start the agent"
}

# ── Main ──
main() {
  echo ""
  echo -e "${BOLD}  ╔══════════════════════════════════╗${NC}"
  echo -e "${BOLD}  ║       Teleton Installer          ║${NC}"
  echo -e "${BOLD}  ║   Personal AI Agent for Telegram ║${NC}"
  echo -e "${BOLD}  ╚══════════════════════════════════╝${NC}"
  echo ""

  detect_os

  local has_docker=false
  local has_node=false

  has docker && has_docker=true
  check_node && has_node=true

  echo ""

  # Offer choices based on what's available
  if $has_docker && $has_node; then
    echo -e "${BOLD}Choose installation method:${NC}"
    echo "  1) npm install -g (recommended)"
    echo "  2) Docker"
    echo "  3) Git clone (development)"
    echo ""
    read -rp "Choice [1]: " choice
    choice="${choice:-1}"
    case "$choice" in
      1) install_npm ;;
      2) install_docker ;;
      3) install_git ;;
      *) error "Invalid choice" ;;
    esac

  elif $has_node; then
    echo -e "${BOLD}Choose installation method:${NC}"
    echo "  1) npm install -g (recommended)"
    echo "  2) Git clone (development)"
    echo ""
    read -rp "Choice [1]: " choice
    choice="${choice:-1}"
    case "$choice" in
      1) install_npm ;;
      2) install_git ;;
      *) error "Invalid choice" ;;
    esac

  elif $has_docker; then
    info "Node.js not found, using Docker"
    install_docker

  else
    error "Neither Node.js >= ${MIN_NODE_VERSION} nor Docker found.

Install one of:
  - Node.js: https://nodejs.org (v${MIN_NODE_VERSION}+)
  - Docker:  https://docs.docker.com/get-docker/"
  fi

  echo ""
  ok "Done!"
}

main "$@"
