#!/bin/bash

# 🚀 Mercury Vercel Deployment Script
# This script will deploy your Mercury app to Vercel

echo "🚀 Mercury Vercel Deployment"
echo "=============================="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found!"
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel
fi

echo "✅ Vercel CLI is installed"
echo ""

# Navigate to mercury directory
cd "$(dirname "$0")"

echo "📁 Current directory: $(pwd)"
echo ""

# Login to Vercel
echo "🔐 Logging into Vercel..."
vercel login

echo ""
echo "🚀 Deploying to Vercel..."
echo ""

# Deploy to production
vercel --prod

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Visit your deployment URL"
echo "2. Test wallet connection"
echo "3. Test grid selection and color changes"
echo "4. Check console for any errors"
echo ""
echo "🎉 Happy trading!"
