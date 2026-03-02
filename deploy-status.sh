#!/bin/bash
###############################################################################
# FIAE Deploy Status Viewer
#
# Quick commands to check deploy status:
#   ./deploy-status.sh           # Show latest deploy result
#   ./deploy-status.sh history   # Show deploy history
#   ./deploy-status.sh logs      # List all log files
#   ./deploy-status.sh tail      # Follow cron log live
###############################################################################

LOG_DIR="/root/app/Wamocon_FIAE/deploy-logs"

case "${1:-}" in
    history)
        echo "=== Deploy History ==="
        if [[ -f "${LOG_DIR}/deploy-history.log" ]]; then
            tail -20 "${LOG_DIR}/deploy-history.log"
        else
            echo "No deploys yet."
        fi
        ;;
    logs)
        echo "=== Log Files ==="
        ls -lht "${LOG_DIR}"/deploy-20*.log 2>/dev/null | head -10
        ;;
    tail)
        echo "=== Following cron log (Ctrl+C to stop) ==="
        tail -f "${LOG_DIR}/cron.log"
        ;;
    full)
        if [[ -f "${LOG_DIR}/latest.log" ]]; then
            cat "${LOG_DIR}/latest.log"
        else
            echo "No deploy logs yet."
        fi
        ;;
    *)
        echo "=== Latest Deploy ==="
        if [[ -f "${LOG_DIR}/deploy-history.log" ]]; then
            tail -1 "${LOG_DIR}/deploy-history.log"
        else
            echo "No deploys yet."
        fi
        echo ""
        echo "=== Docker Status ==="
        docker compose -f /root/app/Wamocon_FIAE/docker-compose.yml ps 2>/dev/null
        echo ""
        echo "Commands:"
        echo "  ./deploy-status.sh history  - Deploy history"
        echo "  ./deploy-status.sh logs     - List log files"
        echo "  ./deploy-status.sh full     - Full latest log"
        echo "  ./deploy-status.sh tail     - Follow cron log"
        ;;
esac
