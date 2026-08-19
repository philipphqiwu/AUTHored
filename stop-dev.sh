#!/bin/bash

# Stop tmux session if it exists
if tmux has-session -t authored 2>/dev/null; then
    echo "Stopping tmux session..."
    tmux kill-session -t authored
fi

# Stop Docker services
echo "Stopping Docker services..."
docker-compose -f docker-compose.dev.yml down

echo "✓ All services stopped"
