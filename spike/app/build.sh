#!/bin/sh
# Builds dist/HVSpike.tipa for TrollStore (arm64, iOS 15.0+), ad-hoc signed.
# Needs ../vendor/build-sherpa-ios.sh to have run (sherpa-onnx static libs + onnxruntime)
# and the KWS model unpacked into ../models (see ../README.md).
set -eu
cd "$(dirname "$0")"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
SDK="$(xcrun --sdk iphoneos --show-sdk-path)"
OUT=../dist
STAGE="$OUT/stage"
APP="$STAGE/Payload/HVSpike.app"
SHERPA=../vendor/sherpa-onnx/build-ios-hv
ORT="$SHERPA/ios-onnxruntime/onnxruntime.xcframework/ios-arm64"
KWS_MODEL=../models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20

rm -rf "$STAGE" && mkdir -p "$APP"
xcrun --sdk iphoneos swiftc -parse-as-library -O -target arm64-apple-ios15.0 -sdk "$SDK" \
  -import-objc-header Bridging.h -Xcc -I"$SHERPA/install/include" \
  -L"$SHERPA/install/lib" \
  -lsherpa-onnx-c-api -lsherpa-onnx-core -lkaldi-decoder-core -lsherpa-onnx-kaldifst-core \
  -lsherpa-onnx-fstfar -lsherpa-onnx-fst -lkaldi-native-fbank-core -lkissfft-float \
  -lssentencepiece_core -lutf8proc \
  -F"$ORT" -framework onnxruntime -lc++ \
  -framework UIKit -framework WebKit -framework AVFoundation -framework AudioToolbox \
  -framework Accelerate -framework CoreML -framework Foundation \
  main.swift Kws.swift -o "$APP/HVSpike"
cp Info.plist "$APP/Info.plist"
plutil -convert binary1 "$APP/Info.plist"
cp -R web "$APP/web"
mkdir -p "$APP/models/kws"
cp "$KWS_MODEL/encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx" "$APP/models/kws/encoder.int8.onnx"
cp "$KWS_MODEL/decoder-epoch-13-avg-2-chunk-16-left-64.onnx" "$APP/models/kws/decoder.onnx"
cp "$KWS_MODEL/joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx" "$APP/models/kws/joiner.int8.onnx"
cp "$KWS_MODEL/tokens.txt" "$APP/models/kws/tokens.txt"
cp ../models/keywords_hv.txt "$APP/models/kws/keywords.txt"
codesign -f -s - --entitlements entitlements.plist "$APP"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Format|Signature" || true
( cd "$STAGE" && rm -f ../HVSpike.tipa && zip -qry ../HVSpike.tipa Payload )
rm -rf "$STAGE"
ls -l "$OUT/HVSpike.tipa"
