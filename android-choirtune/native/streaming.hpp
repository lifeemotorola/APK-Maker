#pragma once
#include <functional>
#include <string>
#include <vector>
namespace choir {
constexpr int SAMPLE_RATE = 44100;
constexpr int MAX_FRAMES = SAMPLE_RATE * 15 * 60;
constexpr int CORE_FRAMES = SAMPLE_RATE * 20;
constexpr int CONTEXT_FRAMES = SAMPLE_RATE * 2;
using Progress = std::function<void(float)>;
// Replaces interleaved stereo samples in place with blended vocal estimates.
using Predictor = std::function<void(std::vector<float>&, const Progress&)>;
// Sequential disk I/O; at most 24 seconds of input plus inference buffers.
void streamVocals(const std::string& pcm, const std::string& wav,
                  const Predictor& predict, const Progress& progress,
                  const std::function<void()>& checkCancel);
}
