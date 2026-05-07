#!/bin/bash
# Build the Android release bundle locally and submit it to Google Play.
# Usage: pnpm ship:android
set -euo pipefail

cd "$(dirname "$0")/.."

PROD_API_URL="https://patterndeck.richardhanss.de/api/v1"
CLIENT_ENV="client/.env"
SUBMIT_PROFILE="${ANDROID_SUBMIT_PROFILE:-android-internal}"
SKIP_SUBMIT="${ANDROID_SKIP_SUBMIT:-0}"
SKIP_CHECKS="${ANDROID_SKIP_CHECKS:-0}"

load_env_file() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

load_env_file "$CLIENT_ENV"
load_env_file "client/.env.local"

EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-$PROD_API_URL}"
if [ "$EXPO_PUBLIC_API_URL" != "$PROD_API_URL" ] && [ "${ALLOW_NON_PROD_ANDROID_API:-0}" != "1" ]; then
  echo "Refusing to ship Android with EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"
  echo "Expected $PROD_API_URL. Set ALLOW_NON_PROD_ANDROID_API=1 only for a deliberate non-prod release."
  exit 1
fi

required_env=(
  ANDROID_UPLOAD_STORE_FILE
  ANDROID_UPLOAD_STORE_PASSWORD
  ANDROID_UPLOAD_KEY_ALIAS
  ANDROID_UPLOAD_KEY_PASSWORD
)

for name in "${required_env[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "Missing $name in $CLIENT_ENV or client/.env.local"
    exit 1
  fi
done

if [ ! -f "client/android/app/$ANDROID_UPLOAD_STORE_FILE" ] && [ ! -f "$ANDROID_UPLOAD_STORE_FILE" ]; then
  echo "Keystore not found. Put it at client/android/app/$ANDROID_UPLOAD_STORE_FILE or use an absolute ANDROID_UPLOAD_STORE_FILE path."
  exit 1
fi

if ! grep -q "ANDROID_UPLOAD_STORE_FILE" client/android/app/build.gradle; then
  echo "client/android/app/build.gradle is not configured for env-driven release signing."
  echo "Regenerate carefully or restore the release signingConfig before shipping."
  exit 1
fi

export EXPO_PUBLIC_API_URL
export BACKEND_DEBUG_UI=0
export NODE_ENV=production

if [ "$SKIP_CHECKS" != "1" ]; then
  echo "=== Typechecking client ==="
  pnpm --filter client typecheck
fi

echo ""
echo "=== Building Android release bundle locally ==="
(
  cd client/android
  ./gradlew bundleRelease \
    -PANDROID_UPLOAD_STORE_FILE="$ANDROID_UPLOAD_STORE_FILE" \
    -PANDROID_UPLOAD_STORE_PASSWORD="$ANDROID_UPLOAD_STORE_PASSWORD" \
    -PANDROID_UPLOAD_KEY_ALIAS="$ANDROID_UPLOAD_KEY_ALIAS" \
    -PANDROID_UPLOAD_KEY_PASSWORD="$ANDROID_UPLOAD_KEY_PASSWORD"
)

AAB_PATH="client/android/app/build/outputs/bundle/release/app-release.aab"
if [ ! -f "$AAB_PATH" ]; then
  echo "Expected bundle not found at $AAB_PATH"
  exit 1
fi

echo ""
echo "Built $AAB_PATH"

if [ "$SKIP_SUBMIT" = "1" ]; then
  echo "Skipping submit because ANDROID_SKIP_SUBMIT=1."
  exit 0
fi

echo ""
echo "=== Submitting to Google Play via EAS Submit ($SUBMIT_PROFILE) ==="
if command -v eas >/dev/null 2>&1; then
  eas submit --platform android --profile "$SUBMIT_PROFILE" --path "$AAB_PATH" --non-interactive
else
  pnpm --dir client dlx eas-cli@latest submit --platform android --profile "$SUBMIT_PROFILE" --path "../$AAB_PATH" --non-interactive
fi

echo ""
echo "=== Android shipment queued ==="
