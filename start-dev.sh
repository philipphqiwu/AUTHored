#!/bin/bash

# Start infrastructure
echo "Starting PostgreSQL and RabbitMQ..."
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be healthy
echo "Waiting for services to be ready..."
sleep 5

# Check if services are healthy
if docker-compose -f docker-compose.dev.yml ps | grep -q "healthy"; then
    echo "✓ Infrastructure is ready!"
else
    echo "✗ Infrastructure failed to start"
    exit 1
fi

# Create tmux session for running multiple services
if command -v tmux &> /dev/null; then
    echo "Starting services in tmux..."
    
    # Kill existing session if it exists
    tmux kill-session -t authored 2>/dev/null || true
    
    # Create new session
    tmux new-session -d -s authored -n "auth-server" "cd auth-provider/server && npm run dev"
    
    # Split window for control panel
    tmux split-window -h -t authored "cd auth-provider/control-panel && npm run dev"
    
    # Split window for app-a
    tmux split-window -v -t authored "cd applications/app-a && npm run dev"
    
    # Split window for app-b
    tmux split-window -v -t authored "cd applications/app-b && npm run dev"
    
    # Select the first pane
    tmux select-pane -t authored:0.0
    
    echo "✓ All services started in tmux session 'authored'"
    echo "  Attach with: tmux attach -t authored"
    echo "  Detach with: Ctrl+B then D"
    echo "  Kill with: tmux kill-session -t authored"
else
    echo "tmux not found. Please start services manually in separate terminals:"
    echo ""
    echo "Terminal 1: cd auth-provider/server && npm run dev"
    echo "Terminal 2: cd auth-provider/control-panel && npm run dev"
    echo "Terminal 3: cd applications/app-a && npm run dev"
    echo "Terminal 4: cd applications/app-b && npm run dev"
fi
