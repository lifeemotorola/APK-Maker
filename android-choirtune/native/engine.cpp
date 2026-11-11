#include "engine.hpp"
#include "model.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace choir {
std::atomic<bool> cancelled{false};
std::atomic<float> progress{0};
static void checkCancel() {
    if (cancelled.load()) throw std::runtime_error("Processing cancelled");
}
static void le(std::ostream& out, uint32_t value, int bytes) {
    for (int i = 0; i < bytes; ++i) out.put(static_cast<char>((value >> (8 * i)) & 255));
}
void isolate(const std::string& path, const std::string& pcm, const std::string& wav) {
    checkCancel();
    std::ifstream input(pcm, std::ios::binary | std::ios::ate);
    if (!input) throw std::runtime_error("Missing PCM input");
    auto bytes = static_cast<long long>(input.tellg());
    if (bytes < 44100 || bytes > MAX_FRAMES * 4 || bytes % 4)
        throw std::runtime_error("Choose a stereo clip between 0.25 and 30 seconds");
    int frames = static_cast<int>(bytes / 4);
    input.seekg(0);
    std::vector<unsigned char> raw(static_cast<size_t>(bytes));
    input.read(reinterpret_cast<char*>(raw.data()), bytes);
    if (!input) throw std::runtime_error("Incomplete PCM input");
    Eigen::MatrixXf audio(2, frames);
    double sum = 0, sum2 = 0;
    for (int i = 0; i < frames; ++i) {
        for (int c = 0; c < 2; ++c) {
            int offset = i * 4 + c * 2;
            int value = raw[offset] | (static_cast<int>(raw[offset + 1]) << 8);
            if (value >= 32768) value -= 65536;
            audio(c, i) = value / 32768.0f;
        }
        double mono = (audio(0, i) + audio(1, i)) * 0.5;
        sum += mono;
        sum2 += mono * mono;
    }
    // Upstream normalizes by mono sample deviation. Reject DC/silence before
    // that division (including exactly anti-phase stereo).
    double variance = sum2 / frames - (sum / frames) * (sum / frames);
    if (variance < 1e-10) throw std::runtime_error("No usable audio: clip is silent, DC or phase-cancelled");
    raw.clear(); raw.shrink_to_fit();
    progress = 0.01f;
    auto model = std::make_unique<demucscpp::demucs_model>();
    if (!demucscpp::load_demucs_model(path, model.get()) || !model->is_4sources)
        throw std::runtime_error("Embedded four-stem Demucs model could not be loaded");
    checkCancel();
    auto stems = demucscpp::demucs_inference(*model, audio,
        [](float fraction, const std::string&) {
            checkCancel();
            progress = std::max(progress.load(), std::min(0.98f, 0.02f + fraction * 0.96f));
        });
    checkCancel();
    if (stems.dimension(0) != 4 || stems.dimension(1) != 2 || stems.dimension(2) != frames)
        throw std::runtime_error("Unexpected Demucs output shape");
    // Demucs stem 3 is blended VOCALS. Stem 1 is an instrument, not choir Bass.
    float peak = 1.0f;
    for (int i = 0; i < frames; ++i) for (int c = 0; c < 2; ++c) {
        float v = stems(3, c, i);
        if (!std::isfinite(v)) throw std::runtime_error("Demucs returned non-finite samples");
        peak = std::max(peak, std::abs(v));
    }
    std::ofstream output(wav, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("Cannot create vocal WAV");
    output.write("RIFF", 4); le(output, frames * 4 + 36, 4);
    output.write("WAVEfmt ", 8); le(output, 16, 4); le(output, 1, 2);
    le(output, 2, 2); le(output, SAMPLE_RATE, 4); le(output, SAMPLE_RATE * 4, 4);
    le(output, 4, 2); le(output, 16, 2); output.write("data", 4); le(output, frames * 4, 4);
    for (int i = 0; i < frames; ++i) {
        if (i % SAMPLE_RATE == 0) checkCancel();
        for (int c = 0; c < 2; ++c) {
            int sample = static_cast<int>(std::lrint(stems(3, c, i) / peak * 32767.0f));
            le(output, static_cast<uint16_t>(sample), 2);
        }
    }
    output.close();
    if (!output) throw std::runtime_error("Could not finish vocal WAV");
    progress = 1.0f;
}
}
