#!/bin/sh
set -eu

MODEL_NAME="parakeet-tdt-0.6b-v3-coreml"
MODEL_ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)/ios/VertexADE/FluidAudioModels}"
MODEL_DIR="$MODEL_ROOT/$MODEL_NAME"
BASE_URL="https://huggingface.co/FluidInference/$MODEL_NAME/resolve/main"

download_file() {
  relative_path="$1"
  destination="$MODEL_DIR/$relative_path"
  if [ -s "$destination" ]; then
    return
  fi
  mkdir -p "$(dirname "$destination")"
  echo "Downloading bundled voice model: $relative_path"
  curl --fail --location --retry 3 --output "$destination.part" "$BASE_URL/$relative_path"
  mv "$destination.part" "$destination"
}

for model in Preprocessor Encoder Decoder JointDecision; do
  download_file "$model.mlmodelc/coremldata.bin"
  download_file "$model.mlmodelc/metadata.json"
  download_file "$model.mlmodelc/model.mil"
  download_file "$model.mlmodelc/weights/weight.bin"
done
download_file "parakeet_vocab.json"

echo "Bundled FluidAudio model ready at $MODEL_DIR"
