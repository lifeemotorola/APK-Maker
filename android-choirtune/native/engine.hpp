#pragma once
#include <atomic>
#include <string>
namespace choir {
constexpr int SAMPLE_RATE = 44100;
constexpr int MAX_FRAMES = SAMPLE_RATE * 30;
extern std::atomic<bool> cancelled;
extern std::atomic<float> progress;
void isolate(const std::string& model, const std::string& pcm, const std::string& wav);
}
