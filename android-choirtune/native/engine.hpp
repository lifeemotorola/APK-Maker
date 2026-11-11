#pragma once
#include <atomic>
#include <string>
#include "streaming.hpp"
namespace choir {
extern std::atomic<bool> cancelled;
extern std::atomic<float> progress;
void isolate(const std::string& model, const std::string& pcm, const std::string& wav);
}
