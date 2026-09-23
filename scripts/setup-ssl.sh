#!/bin/bash
# ==============================================================================
# setup-ssl.sh — Obtain or renew SSL certificates via Let's Encrypt (certbot)
#
# Run this ONCE on your server before starting the full stack.
# After certs are obtained, docker compose handles renewal via a cron job.
#
# Usage:
#   chmod +x scripts/setup-ssl.sh
#   ./scripts/setup-ssl.sh yourdomain.com admin@yourdomain.com
# ==============================================================================
set -e

DOMAIN=${1:?"Usage: $0 <domain> <email>"}
EMAIL=${2:?"Usage: $0 <domain> <email>"}
SSL_DIR="./nginx/ssl"

echo "🔐 Setting up SSL for $DOMAIN..."

# ── Option A: Let's Encrypt (recommended for public servers) ──────────────────
if command -v certbot &>/dev/null; then
    echo "📋 Using certbot (Let's Encrypt)..."

    # Start a temporary nginx just for the ACME challenge
    docker run --rm -d \
        --name temp_nginx \
        -p 80:80 \
        -v "$(pwd)/nginx/ssl:/etc/nginx/ssl" \
        -v certbot_webroot:/var/www/certbot \
        nginx:1.27-alpine \
        nginx -g "daemon off;" &

    sleep 2

    certbot certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        -d "$DOMAIN" \
        -d "www.$DOMAIN"

    docker stop temp_nginx 2>/dev/null || true

    # Copy certs to the nginx ssl directory
    mkdir -p "$SSL_DIR"
    cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$SSL_DIR/fullchain.pem"
    cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   "$SSL_DIR/privkey.pem"

    echo "✅ Let's Encrypt certs installed to $SSL_DIR"
else
    # ── Option B: Self-signed (for testing only — NOT for production) ─────────
    echo "⚠️  certbot not found — generating self-signed cert (testing only!)"
    echo "   For production, install certbot: https://certbot.eff.org/instructions"

    mkdir -p "$SSL_DIR"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_DIR/privkey.pem" \
        -out    "$SSL_DIR/fullchain.pem" \
        -subj "/C=US/ST=State/L=City/O=VoiceAI/CN=$DOMAIN"

    echo "⚠️  Self-signed cert generated. Replace with real certs before launch!"
fi

# ── DH Parameters (improves forward secrecy) ──────────────────────────────────
if [ ! -f "$SSL_DIR/dhparam.pem" ]; then
    echo "⏳ Generating DH parameters (this takes ~1 minute)..."
    openssl dhparam -out "$SSL_DIR/dhparam.pem" 2048
    echo "✅ DH parameters generated"
fi

echo ""
echo "✅ SSL setup complete!"
echo "   Certs: $SSL_DIR/fullchain.pem"
echo "   Key:   $SSL_DIR/privkey.pem"
echo "   DH:    $SSL_DIR/dhparam.pem"
echo ""
echo "Next step: docker compose --env-file .env.production up -d --build"