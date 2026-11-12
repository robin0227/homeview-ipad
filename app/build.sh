#!/bin/sh
# Builds dist/HomeView.tipa for TrollStore (arm64, iOS 15.0+), ad-hoc signed.
set -eu
cd "$(dirname "$0")"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
STAGE=dist/stage
APP="$STAGE/Payload/HomeView.app"

rm -rf "$STAGE" && mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -parse-as-library -O -target arm64-apple-ios15.0 -sdk "$SDK" \
  -framework UIKit -framework WebKit \
  native/App.swift -o "$APP/HomeView"
cp native/Info.plist "$APP/Info.plist"
plutil -convert binary1 "$APP/Info.plist"
mkdir -p "$APP/web"
cp -R web/index.html web/css web/js "$APP/web/"
[ -f dist/icons/AppIcon76x76@2x.png ] || { mkdir -p dist/icons && xcrun swift tools/make-icon.swift dist/icons; }
cp dist/icons/*.png "$APP/"
codesign -f -s - --entitlements native/entitlements.plist "$APP"
( cd "$STAGE" && rm -f ../HomeView.tipa && zip -qry ../HomeView.tipa Payload )
rm -rf "$STAGE"
ls -l dist/HomeView.tipa
