#!/bin/sh
# Builds sherpa-onnx v2.0.1 (static, no TTS, C API) for iPad arm64, iOS 15.0.
# CMake fetches sherpa-onnx's own dependencies (kaldi-native-fbank, kaldi-decoder,
# simple-sentencepiece, kissfft, ...) from GitHub during configure.
# Output: sherpa-onnx/build-ios-hv/install/{lib,include}
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/../.tools/bin:$PATH"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
B="$HERE/sherpa-onnx/build-ios-hv"
ORT="$B/ios-onnxruntime/onnxruntime.xcframework/ios-arm64"
export SHERPA_ONNXRUNTIME_LIB_DIR="$ORT"
export SHERPA_ONNXRUNTIME_INCLUDE_DIR="$ORT/onnxruntime.framework/Headers"
cd "$B"
rm -rf os64
cmake -G Ninja -S "$HERE/sherpa-onnx" -B os64 -DCMAKE_MAKE_PROGRAM="$HERE/../.tools/bin/ninja" \
  -DCMAKE_TOOLCHAIN_FILE="$HERE/sherpa-onnx/toolchains/ios.toolchain.cmake" -DPLATFORM=OS64 -DDEPLOYMENT_TARGET=15.0 \
  -DENABLE_BITCODE=0 -DENABLE_ARC=1 -DENABLE_VISIBILITY=0 \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$B/install" -DBUILD_SHARED_LIBS=OFF \
  -DSHERPA_ONNX_ENABLE_TTS=OFF -DSHERPA_ONNX_ENABLE_PYTHON=OFF -DSHERPA_ONNX_ENABLE_BINARY=OFF \
  -DSHERPA_ONNX_ENABLE_TESTS=OFF -DSHERPA_ONNX_ENABLE_CHECK=OFF -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \
  -DSHERPA_ONNX_ENABLE_JNI=OFF -DSHERPA_ONNX_ENABLE_C_API=ON -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF
cmake --build os64 -j 8
cmake --build os64 --target install
ls -l "$B/install/lib"
